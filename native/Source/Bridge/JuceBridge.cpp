#include "JuceBridge.h"
#include <juce_gui_basics/juce_gui_basics.h>
#include <algorithm>
#include <cmath>
#include "Audio/OfflineRenderer.h"

namespace
{
    // One bounce per file at a time; the completion is posted back to the message thread
    // because the pool thread must never touch the browser or the FileChooser.
    struct OfflineRenderJob : public juce::ThreadPoolJob
    {
        OfflineRenderer::RenderJob job;
        AudioEngine& engine;
        double liveSampleRate = 44100.0;
        int liveBlockSize = 512;
        juce::String outputPath;
        juce::WebBrowserComponent::NativeFunctionCompletion complete;
        std::atomic<int>& counter;

        OfflineRenderJob(OfflineRenderer::RenderJob renderJob, AudioEngine& eng, double rate, int block,
                         juce::String path, juce::WebBrowserComponent::NativeFunctionCompletion done,
                         std::atomic<int>& inFlight)
            : ThreadPoolJob("MuseGridOfflineRender"), job(std::move(renderJob)), engine(eng),
              liveSampleRate(rate), liveBlockSize(block), outputPath(std::move(path)),
              complete(std::move(done)), counter(inFlight)
        {}

        JobStatus runJob() override
        {
            const auto result = OfflineRenderer::renderToFile(job, engine, liveSampleRate, liveBlockSize);
            counter.fetch_sub(1, std::memory_order_acq_rel);

            if (shouldExit()) return jobHasFinished;   // app is shutting down: nobody to report to

            juce::DynamicObject::Ptr res = new juce::DynamicObject();
            res->setProperty("success", result.success);
            res->setProperty("path", outputPath);
            res->setProperty("peakLinear", result.peakLinear);
            res->setProperty("appliedGain", result.appliedGain);
            res->setProperty("message", result.message);

            const juce::var payload(res.get());
            auto completion = complete;
            juce::MessageManager::callAsync([completion, payload] { completion(payload); });

            return jobHasFinished;
        }
    };

    juce::File renderTempDir()
    {
        return juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("MuseGridRenders");
    }

    // Shared payload parser for the dialog-driven WAV bounce and the temp-file bounce
    // used by MP3 / multi-region exports.
    bool parseRenderJob(const juce::var& input, OfflineRenderer::RenderJob& job, juce::String& error)
    {
        juce::var parsed = input;
        if (parsed.isString()) parsed = juce::JSON::parse(parsed.toString());
        if (!parsed.isObject()) { error = "Invalid render payload"; return false; }
        auto* obj = parsed.getDynamicObject();

        job.sampleRate = obj->hasProperty("sampleRate") ? (double)obj->getProperty("sampleRate") : 44100.0;
        job.bitDepth = obj->hasProperty("bitDepth") ? (int)obj->getProperty("bitDepth") : 24;
        job.totalDurationSeconds = obj->hasProperty("durationSeconds") ? (double)obj->getProperty("durationSeconds") : 10.0;
        job.normalize = obj->hasProperty("normalize") ? (bool)obj->getProperty("normalize") : true;
        job.normalizeTargetDb = obj->hasProperty("normalizeTargetDb") ? (double)obj->getProperty("normalizeTargetDb") : -1.0;
        job.autoFade = obj->hasProperty("autoFade") ? (bool)obj->getProperty("autoFade") : true;
        job.fadeSeconds = obj->hasProperty("fadeSeconds") ? (double)obj->getProperty("fadeSeconds") : 0.5;

        if (auto* arr = obj->getProperty("events").getArray())
            for (const auto& ev : *arr) job.events.add(ev);
        if (auto* overrides = obj->getProperty("trackOverrides").getArray())
            for (const auto& ov : *overrides) job.trackOverrides.add(ov);

        if (auto* m = obj->getProperty("metronome").getDynamicObject())
        {
            auto number = [m](const char* key, double fallback) {
                return m->hasProperty(key) ? (double)m->getProperty(key) : fallback;
            };

            auto& cfg = job.metronome;
            cfg.enabled = true;
            cfg.bpm = std::max(1.0, number("bpm", 120.0));
            cfg.startTick = std::max(0.0, number("startTick", 0.0));
            cfg.beatsPerMeasure = std::max(1, (int)number("beatsPerMeasure", 4.0));
            cfg.metronomeVolume = juce::jlimit(0.0, 1.0, number("metronomeVolume", 1.0));
            cfg.gainDb = number("gainDb", 0.0);
            cfg.pitchDecay = std::max(0.0, number("pitchDecay", 0.01));
            cfg.octaves = std::max(1.0, number("octaves", 2.0));
            cfg.attack = std::max(0.0, number("attack", 0.001));
            cfg.decay = std::max(0.0, number("decay", 0.1));
            cfg.sustain = juce::jlimit(0.0, 1.0, number("sustain", 0.0));
            cfg.release = std::max(0.0, number("release", 0.1));
            cfg.downbeatVel = juce::jlimit(0.0, 1.0, number("downbeatVel", 1.0));
            cfg.upbeatVel = juce::jlimit(0.0, 1.0, number("upbeatVel", 0.65));
            if (m->hasProperty("downbeatPitch")) cfg.downbeatPitch = m->getProperty("downbeatPitch").toString();
            if (m->hasProperty("upbeatPitch")) cfg.upbeatPitch = m->getProperty("upbeatPitch").toString();
        }

        if (job.totalDurationSeconds <= 0.0 || (job.events.isEmpty() && !job.metronome.enabled))
        {
            error = "Nothing to render";
            return false;
        }
        return true;
    }
}

JuceBridge::JuceBridge(AudioEngine& engine)
    : audioEngine(engine)
{
}

juce::WebBrowserComponent::Options JuceBridge::setupOptions(juce::WebBrowserComponent::Options options)
{
    // JavaScript shim injecting window.ipcRenderer and audio bridge
    const juce::String initScript = R"(
        (function() {
            window.__isJuceNative__ = true;

            var promiseIdCounter = 1;
            var activePromises = {};

            function setupCompletionListener() {
                if (window.__JUCE__ && window.__JUCE__.backend && window.__JUCE__.backend.addEventListener) {
                    window.__JUCE__.backend.addEventListener('__juce__complete', function(data) {
                        if (data && data.promiseId !== undefined) {
                            var p = activePromises[data.promiseId];
                            if (p) {
                                p.resolve(data.result);
                                delete activePromises[data.promiseId];
                            }
                        }
                    });
                }
            }
            setupCompletionListener();

            function invokeJuce(name, params) {
                return new Promise(function(resolve, reject) {
                    try {
                        setupCompletionListener();
                        var pid = promiseIdCounter++;
                        activePromises[pid] = { resolve: resolve, reject: reject };
                        if (window.__JUCE__ && window.__JUCE__.backend && window.__JUCE__.backend.emitEvent) {
                            window.__JUCE__.backend.emitEvent('__juce__invoke', {
                                name: name,
                                params: params || [],
                                resultId: pid
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            }

            window.ipcRenderer = {
                invoke: function(channel, ...args) {
                    return invokeJuce(channel, args);
                },
                send: function(channel, ...args) {
                    invokeJuce(channel, args).catch(function(e) {
                        console.error('[JUCE Bridge] send failed:', e);
                    });
                },
                on: function(channel, listener) {
                    if (window.__JUCE__ && window.__JUCE__.backend && window.__JUCE__.backend.addEventListener) {
                        window.__JUCE__.backend.addEventListener(channel, listener);
                    }
                },
                off: function(channel, listener) {
                    if (window.__JUCE__ && window.__JUCE__.backend && window.__JUCE__.backend.removeEventListener) {
                        window.__JUCE__.backend.removeEventListener(channel, listener);
                    }
                }
            };

            window.juceAudioBridge = {
                postCommand: function(cmd) {
                    return invokeJuce('audioCommand', [JSON.stringify(cmd)]);
                }
            };

            function sendToHost(type, msg) {
                try {
                    if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
                        window.chrome.webview.postMessage(JSON.stringify({ type: type, text: msg }));
                    }
                } catch (err) {}
            }

            var origLog = console.log;
            var origWarn = console.warn;
            var origError = console.error;
            console.log = function(...args) {
                origLog.apply(console, args);
                sendToHost('LOG', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
            };
            console.warn = function(...args) {
                origWarn.apply(console, args);
                sendToHost('WARN', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
            };
            console.error = function(...args) {
                origError.apply(console, args);
                sendToHost('ERROR', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
            };

            window.addEventListener('error', function(e) {
                sendToHost('UNCAUGHT_ERR', e.message + ' at ' + e.filename + ':' + e.lineno + ' - ' + (e.error ? e.error.stack : ''));
            });
            window.addEventListener('unhandledrejection', function(e) {
                sendToHost('UNHANDLED_REJECTION', (e.reason && e.reason.stack) ? e.reason.stack : String(e.reason));
            });

            console.log('[JUCE Native] Bridge and event dispatchers initialized successfully.');
        })();
    )";

    return options
        .withNativeIntegrationEnabled(true)
        .withUserScript(initScript)
        .withNativeFunction("save-project", [this](auto& args, auto comp) { handleSaveProject(args, comp); })
        .withNativeFunction("save-project-path", [this](auto& args, auto comp) { handleSaveProjectPath(args, comp); })
        .withNativeFunction("open-project", [this](auto& args, auto comp) { handleOpenProject(args, comp); })
        .withNativeFunction("open-project-path", [this](auto& args, auto comp) { handleOpenProjectPath(args, comp); })
        .withNativeFunction("save-midi", [this](auto& args, auto comp) { handleSaveMidi(args, comp); })
        .withNativeFunction("save-file", [this](auto& args, auto comp) { handleSaveFile(args, comp); })
        .withNativeFunction("render-audio", [this](auto& args, auto comp) { handleRenderAudio(args, comp); })
        .withNativeFunction("render-audio-temp", [this](auto& args, auto comp) { handleRenderAudioTemp(args, comp); })
        .withNativeFunction("release-native-render", [this](auto& args, auto comp) { handleReleaseNativeRender(args, comp); })
        .withNativeFunction("show-open-dialog", [this](auto& args, auto comp) { handleShowOpenDialog(args, comp); })
        .withNativeFunction("delete-file", [this](auto& args, auto comp) { handleDeleteFile(args, comp); })
        .withNativeFunction("permanent-delete-file", [this](auto& args, auto comp) { handlePermanentDeleteFile(args, comp); })
        .withNativeFunction("toggle-fullscreen", [this](auto& args, auto comp) { handleToggleFullscreen(args, comp); })
        .withNativeFunction("set-fullscreen", [this](auto& args, auto comp) { handleSetFullscreen(args, comp); })
        .withNativeFunction("is-fullscreen", [this](auto& args, auto comp) { handleIsFullscreen(args, comp); })
        .withNativeFunction("audioCommand", [this](auto& args, auto comp) { handleAudioCommand(args, comp); })
        .withNativeFunction("vst3-scan", [this](auto& args, auto comp) { handleVst3Scan(args, comp); })
        .withNativeFunction("vst3-get-plugins", [this](auto& args, auto comp) { handleVst3GetPlugins(args, comp); })
        .withNativeFunction("vst3-track-parameters", [this](auto& args, auto comp) {
            if (args.isEmpty()) { comp(juce::Array<juce::var>()); return; }
            comp(audioEngine.getTrackVst3Parameters(args[0].toString()));
        })
        .withNativeFunction("vst3-open-editor", [this](auto& args, auto comp) { handleVst3OpenEditor(args, comp); })
        .withNativeFunction("get-clipboard-text", [](const auto&, auto comp) {
            comp(juce::SystemClipboard::getTextFromClipboard());
        })
        .withNativeFunction("set-clipboard-text", [](const auto& args, auto comp) {
            if (!args.isEmpty())
                juce::SystemClipboard::copyTextToClipboard(args[0].toString());
            comp(true);
        })
        .withNativeFunction("quit-app", [this](const auto&, auto comp) {
            if (onForceQuit)
                onForceQuit();
            else if (auto* app = juce::JUCEApplication::getInstance())
                app->systemRequestedQuit();
            comp(true);
        })
        .withNativeFunction("force-quit-app", [this](const auto&, auto comp) {
            if (onForceQuit)
                onForceQuit();
            else if (auto* app = juce::JUCEApplication::getInstance())
                app->systemRequestedQuit();
            comp(true);
        })
        .withNativeFunction("get-audio-device-setup", [this](auto& args, auto comp) {
            handleGetAudioDeviceSetup(args, comp);
        })
        .withNativeFunction("set-audio-device-setup", [this](auto& args, auto comp) {
            handleSetAudioDeviceSetup(args, comp);
        });
}

void JuceBridge::handleSaveProject(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty()) { complete(juce::var()); return; }
    const juce::String projectData = args[0].toString();

    auto chooser = std::make_shared<juce::FileChooser>("Save MuseGrid Project", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory), "*.muz");
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles, [chooser, projectData, complete](const juce::FileChooser& fc) {
        auto file = fc.getResult();
        if (file.getFullPathName().isEmpty())
        {
            complete(juce::var());
            return;
        }

        if (!file.hasFileExtension(".muz"))
            file = file.withFileExtension(".muz");

        // Write with GZIP compression matching Electron's zlib.gzipSync
        juce::MemoryOutputStream rawStream;
        rawStream.write(projectData.toRawUTF8(), projectData.getNumBytesAsUTF8());

        if (file.exists()) file.deleteFile();
        auto outStream = file.createOutputStream();
        if (outStream)
        {
            juce::GZIPCompressorOutputStream gzipStream(outStream.get(), 6, false);
            gzipStream.write(rawStream.getData(), rawStream.getDataSize());
            gzipStream.flush();
            outStream.release();
            complete(file.getFullPathName());
            return;
        }

        complete(juce::var());
    });
}

void JuceBridge::handleSaveProjectPath(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.size() < 2) { complete(false); return; }
    const juce::String projectData = args[0].toString();
    const juce::File file(args[1].toString());

    juce::MemoryOutputStream rawStream;
    rawStream.write(projectData.toRawUTF8(), projectData.getNumBytesAsUTF8());

    if (file.exists()) file.deleteFile();
    auto outStream = file.createOutputStream();
    if (outStream)
    {
        juce::GZIPCompressorOutputStream gzipStream(outStream.get(), 6, false);
        gzipStream.write(rawStream.getData(), rawStream.getDataSize());
        gzipStream.flush();
        outStream.release();
        complete(true);
        return;
    }

    complete(false);
}

void JuceBridge::handleOpenProject(const juce::Array<juce::var>& /*args*/, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    auto chooser = std::make_shared<juce::FileChooser>("Open MuseGrid Project", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory), "*.muz;*.muztrack;*.json");
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [chooser, complete](const juce::FileChooser& fc) {
        auto file = fc.getResult();
        if (!file.existsAsFile())
        {
            complete(juce::var());
            return;
        }

        const juce::String ext = file.getFileExtension().toLowerCase();
        if (ext == ".mid" || ext == ".midi")
        {
            juce::DynamicObject::Ptr errObj = new juce::DynamicObject();
            errObj->setProperty("error", "Standard MIDI files (.mid) require channel mapping. Please open a .muz or .muztrack project.");
            errObj->setProperty("filePath", file.getFullPathName());
            complete(juce::var(errObj.get()));
            return;
        }

        juce::String content;
        auto inStream = file.createInputStream();
        if (inStream)
        {
            // Try GZIP decompression first
            try
            {
                juce::GZIPDecompressorInputStream gzipStream(inStream.get(), false);
                content = gzipStream.readEntireStreamAsString();
            }
            catch (...)
            {
                // Fallback to plain text JSON
                inStream->setPosition(0);
                content = inStream->readEntireStreamAsString();
            }
            inStream.release();
        }

        juce::DynamicObject::Ptr resultObj = new juce::DynamicObject();
        resultObj->setProperty("data", content);
        resultObj->setProperty("filePath", file.getFullPathName());

        complete(juce::var(resultObj.get()));
    });
}

void JuceBridge::handleOpenProjectPath(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty())
    {
        complete(juce::var());
        return;
    }

    const juce::File file(args[0].toString());
    if (!file.existsAsFile())
    {
        juce::DynamicObject::Ptr errObj = new juce::DynamicObject();
        errObj->setProperty("error", "Project file does not exist on disk.");
        complete(juce::var(errObj.get()));
        return;
    }

    const juce::String ext = file.getFileExtension().toLowerCase();
    if (ext == ".mid" || ext == ".midi")
    {
        juce::DynamicObject::Ptr errObj = new juce::DynamicObject();
        errObj->setProperty("error", "Standard MIDI files (.mid) require channel mapping. Please open a .muz or .muztrack project.");
        errObj->setProperty("filePath", file.getFullPathName());
        complete(juce::var(errObj.get()));
        return;
    }

    juce::String content;
    auto inStream = file.createInputStream();
    if (inStream)
    {
        try
        {
            juce::GZIPDecompressorInputStream gzipStream(inStream.get(), false);
            content = gzipStream.readEntireStreamAsString();
        }
        catch (...)
        {
            inStream->setPosition(0);
            content = inStream->readEntireStreamAsString();
        }
        inStream.release();
    }

    juce::DynamicObject::Ptr resultObj = new juce::DynamicObject();
    resultObj->setProperty("data", content);
    resultObj->setProperty("filePath", file.getFullPathName());

    complete(juce::var(resultObj.get()));
}

void JuceBridge::handleSaveMidi(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty()) { complete(false); return; }

    auto chooser = std::make_shared<juce::FileChooser>("Export MIDI", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory), "*.mid");
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles, [chooser, args, complete](const juce::FileChooser& fc) {
        auto file = fc.getResult();
        if (file.getFullPathName().isEmpty())
        {
            complete(false);
            return;
        }

        if (!file.hasFileExtension(".mid"))
            file = file.withFileExtension(".mid");

        if (file.exists()) file.deleteFile();
        auto outStream = file.createOutputStream();
        if (!outStream) { complete(false); return; }

        if (auto* memBlock = args[0].getBinaryData())
        {
            outStream->write(memBlock->getData(), memBlock->getSize());
        }
        else
        {
            // Array of bytes
            auto arr = args[0].getArray();
            if (arr != nullptr)
            {
                for (int i = 0; i < arr->size(); ++i)
                {
                    uint8_t byteVal = (uint8_t)(int)arr->getUnchecked(i);
                    outStream->writeByte((char)byteVal);
                }
            }
        }

        complete(true);
    });
}

void JuceBridge::handleSaveFile(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty()) { complete(juce::var()); return; }

    juce::String title = "Save File";
    juce::String defaultFilename = "export";
    juce::String pattern = "*.*";
    juce::MemoryBlock fileData;

    if (args[0].isObject())
    {
        auto* obj = args[0].getDynamicObject();
        if (obj->hasProperty("title")) title = obj->getProperty("title").toString();
        if (obj->hasProperty("filename")) defaultFilename = obj->getProperty("filename").toString();
        if (obj->hasProperty("pattern")) pattern = obj->getProperty("pattern").toString();

        auto dataVar = obj->getProperty("data");
        if (auto* mem = dataVar.getBinaryData())
        {
            fileData = *mem;
        }
        else if (dataVar.isString())
        {
            juce::String str = dataVar.toString();
            if (str.startsWith("data:") && str.contains(";base64,"))
                str = str.fromFirstOccurrenceOf(";base64,", false, false);

            juce::MemoryOutputStream mos;
            if (juce::Base64::convertFromBase64(mos, str))
            {
                fileData = mos.getMemoryBlock();
            }
            else
            {
                fileData.append(str.toRawUTF8(), str.getNumBytesAsUTF8());
            }
        }
        else if (auto* arr = dataVar.getArray())
        {
            fileData.setSize((size_t)arr->size());
            for (int i = 0; i < arr->size(); ++i)
                fileData[(size_t)i] = (char)(uint8_t)(int)arr->getUnchecked(i);
        }
    }
    else
    {
        if (args.size() > 1) defaultFilename = args[1].toString();
        if (args.size() > 2) pattern = args[2].toString();
        if (args.size() > 3) title = args[3].toString();

        if (args[0].isString())
        {
            juce::String str = args[0].toString();
            if (str.startsWith("data:") && str.contains(";base64,"))
                str = str.fromFirstOccurrenceOf(";base64,", false, false);

            juce::MemoryOutputStream mos;
            if (juce::Base64::convertFromBase64(mos, str))
            {
                fileData = mos.getMemoryBlock();
            }
            else
            {
                fileData.append(str.toRawUTF8(), str.getNumBytesAsUTF8());
            }
        }
        else if (auto* arr = args[0].getArray())
        {
            fileData.setSize((size_t)arr->size());
            for (int i = 0; i < arr->size(); ++i)
                fileData[(size_t)i] = (char)(uint8_t)(int)arr->getUnchecked(i);
        }
    }

    if (pattern == "*.*" && defaultFilename.containsChar('.'))
    {
        pattern = "*" + defaultFilename.substring(defaultFilename.lastIndexOfChar('.'));
    }

    auto initialFile = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile(defaultFilename);
    auto chooser = std::make_shared<juce::FileChooser>(title, initialFile, pattern);

    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
        [chooser, fileData, defaultFilename, complete](const juce::FileChooser& fc) {
            auto file = fc.getResult();
            if (file.getFullPathName().isEmpty())
            {
                complete(juce::var());
                return;
            }

            if (defaultFilename.containsChar('.'))
            {
                auto ext = defaultFilename.substring(defaultFilename.lastIndexOfChar('.'));
                if (!file.hasFileExtension(ext))
                    file = file.withFileExtension(ext);
            }

            if (file.exists()) file.deleteFile();
            auto outStream = file.createOutputStream();
            if (!outStream)
            {
                complete(juce::var());
                return;
            }

            if (fileData.getSize() > 0)
                outStream->write(fileData.getData(), fileData.getSize());

            outStream->flush();
            complete(file.getFullPathName());
        });
}

void JuceBridge::handleRenderAudio(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    auto fail = [&complete](const juce::String& message) {
        juce::DynamicObject::Ptr res = new juce::DynamicObject();
        res->setProperty("success", false);
        res->setProperty("message", message);
        complete(juce::var(res.get()));
    };

    if (args.isEmpty()) { fail("Missing render payload"); return; }

    juce::var parsed = args[0];
    if (parsed.isString()) parsed = juce::JSON::parse(parsed.toString());
    if (!parsed.isObject()) { fail("Invalid render payload"); return; }
    auto* obj = parsed.getDynamicObject();

    if (activeRenders.load(std::memory_order_acquire) > 0) { fail("A render is already running"); return; }

    OfflineRenderer::RenderJob job;
    juce::String parseError;
    if (!parseRenderJob(parsed, job, parseError)) { fail(parseError); return; }

    juce::String defaultFilename = obj->hasProperty("filename") ? obj->getProperty("filename").toString() : "export";
    if (!defaultFilename.endsWithIgnoreCase(".wav")) defaultFilename += ".wav";
    const juce::String title = obj->hasProperty("title") ? obj->getProperty("title").toString() : "Export Audio";

    auto initialFile = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile(defaultFilename);
    auto chooser = std::make_shared<juce::FileChooser>(title, initialFile, "*.wav");

    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
        [this, chooser, job, defaultFilename, complete](const juce::FileChooser& fc) mutable {
            const auto chosen = fc.getResult();
            if (chosen.getFullPathName().isEmpty())
            {
                complete(juce::var());
                return;
            }

            job.outputFile = chosen.withFileExtension(".wav");

            auto* device = audioEngine.getDeviceManager().getCurrentAudioDevice();
            const double liveRate = device != nullptr ? device->getCurrentSampleRate() : audioEngine.getSampleRate();
            const int liveBlock = device != nullptr ? device->getCurrentBufferSizeSamples() : 512;

            activeRenders.fetch_add(1, std::memory_order_acq_rel);
            renderPool.addJob(new OfflineRenderJob(job, audioEngine, liveRate, liveBlock,
                                                   job.outputFile.getFullPathName(), complete, activeRenders), true);
        });
}

// Renders to a private temp WAV instead of a user-chosen file. The web layer fetches it
// through the resource provider, encodes MP3 or stitches regions, then releases it.
void JuceBridge::handleRenderAudioTemp(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    auto fail = [&complete](const juce::String& message) {
        juce::DynamicObject::Ptr res = new juce::DynamicObject();
        res->setProperty("success", false);
        res->setProperty("message", message);
        complete(juce::var(res.get()));
    };

    if (args.isEmpty()) { fail("Missing render payload"); return; }
    if (activeRenders.load(std::memory_order_acquire) > 0) { fail("A render is already running"); return; }

    OfflineRenderer::RenderJob job;
    juce::String parseError;
    if (!parseRenderJob(args[0], job, parseError)) { fail(parseError); return; }

    auto tempDir = renderTempDir();
    tempDir.createDirectory();

    // A crashed session can leave renders behind; anything older than an hour is stale.
    const auto cutoff = juce::Time::getCurrentTime() - juce::RelativeTime::hours(1);
    for (const auto& entry : juce::RangedDirectoryIterator(tempDir, false, "*.wav"))
        if (entry.getFile().getLastModificationTime() < cutoff)
            entry.getFile().deleteFile();

    const juce::String name = "render-" + juce::String(juce::Time::currentTimeMillis()) + "-"
        + juce::String(juce::Random::getSystemRandom().nextInt(100000)) + ".wav";
    auto outFile = tempDir.getChildFile(name);
    job.outputFile = outFile;

    auto* device = audioEngine.getDeviceManager().getCurrentAudioDevice();
    const double liveRate = device != nullptr ? device->getCurrentSampleRate() : audioEngine.getSampleRate();
    const int liveBlock = device != nullptr ? device->getCurrentBufferSizeSamples() : 512;

    const juce::String url = "/musegrid-render/" + name;
    const juce::String path = outFile.getFullPathName();

    activeRenders.fetch_add(1, std::memory_order_acq_rel);
    renderPool.addJob(new OfflineRenderJob(job, audioEngine, liveRate, liveBlock, path,
        [complete, url, path](juce::var payload) {
            if (auto* obj = payload.getDynamicObject())
            {
                obj->setProperty("url", url);
                if (!(bool)obj->getProperty("success"))
                    juce::File(path).deleteFile();
            }
            complete(payload);
        }, activeRenders), true);
}

void JuceBridge::handleReleaseNativeRender(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (!args.isEmpty())
    {
        auto file = juce::File(args[0].toString());
        if (file.isAChildOf(renderTempDir()))
            file.deleteFile();
    }
    complete(true);
}

void JuceBridge::handleShowOpenDialog(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    juce::String title = "Open File";
    juce::String patterns = "*.*";

    if (!args.isEmpty() && args[0].isObject())
    {
        auto* obj = args[0].getDynamicObject();
        if (obj->hasProperty("title")) title = obj->getProperty("title").toString();
        if (obj->hasProperty("filters"))
        {
            auto filtersVar = obj->getProperty("filters");
            if (auto* arr = filtersVar.getArray())
            {
                juce::StringArray patternList;
                for (const auto& item : *arr)
                {
                    if (item.isObject())
                    {
                        auto* itemObj = item.getDynamicObject();
                        if (itemObj->hasProperty("extensions"))
                        {
                            auto extVar = itemObj->getProperty("extensions");
                            if (auto* extArr = extVar.getArray())
                            {
                                for (const auto& ext : *extArr)
                                {
                                    juce::String e = ext.toString().trim();
                                    if (e == "*") patternList.add("*.*");
                                    else if (e.startsWith("*.")) patternList.add(e);
                                    else if (e.startsWith(".")) patternList.add("*" + e);
                                    else patternList.add("*." + e);
                                }
                            }
                        }
                    }
                }
                // If specific extension patterns exist alongside "*.*", drop "*.*" so it filters strictly
                if (patternList.size() > 1 && patternList.contains("*.*"))
                    patternList.removeString("*.*");

                if (!patternList.isEmpty())
                    patterns = patternList.joinIntoString(";");
            }
        }
    }

    auto chooser = std::make_shared<juce::FileChooser>(title, juce::File::getSpecialLocation(juce::File::userDocumentsDirectory), patterns);
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [chooser, complete](const juce::FileChooser& fc) {
        auto file = fc.getResult();
        if (!file.existsAsFile())
        {
            complete(juce::var());
            return;
        }

        juce::MemoryBlock memBlock;
        file.loadFileAsData(memBlock);

        juce::DynamicObject::Ptr res = new juce::DynamicObject();
        res->setProperty("name", file.getFileName());
        res->setProperty("filePath", file.getFullPathName());
        res->setProperty("data", juce::Base64::toBase64(memBlock.getData(), memBlock.getSize()));
        res->setProperty("isBase64", true);

        complete(juce::var(res.get()));
    });
}

void JuceBridge::handleDeleteFile(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty()) { complete(false); return; }
    const juce::File file(args[0].toString());
    if (!file.existsAsFile())
    {
        complete(true);
        return;
    }
    // Attempt move to Recycle Bin / Trash first for safe deletion
    bool ok = file.moveToTrash();
    if (!ok)
    {
        ok = file.deleteFile();
    }
    complete(ok);
}

void JuceBridge::handlePermanentDeleteFile(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty()) { complete(false); return; }
    const juce::File file(args[0].toString());
    if (!file.existsAsFile())
    {
        complete(true);
        return;
    }
    bool ok = file.deleteFile();
    complete(ok);
}

void JuceBridge::handleToggleFullscreen(const juce::Array<juce::var>& /*args*/, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (mainWindow != nullptr)
    {
        bool isFull = mainWindow->isFullScreen();
        mainWindow->setFullScreen(!isFull);
        complete(!isFull);
        return;
    }
    complete(false);
}

void JuceBridge::handleSetFullscreen(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (mainWindow != nullptr)
    {
        bool wantFull = true;
        if (!args.isEmpty())
        {
            wantFull = (bool)args[0];
        }
        mainWindow->setFullScreen(wantFull);
        complete(mainWindow->isFullScreen());
        return;
    }
    complete(false);
}

void JuceBridge::handleIsFullscreen(const juce::Array<juce::var>& /*args*/, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (mainWindow != nullptr)
    {
        complete(mainWindow->isFullScreen());
        return;
    }
    complete(false);
}

void JuceBridge::handleAudioCommand(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty()) { complete(false); return; }
    const juce::String jsonStr = args[0].toString();
    auto parsed = juce::JSON::parse(jsonStr);

    if (!parsed.isObject()) { complete(false); return; }
    auto* obj = parsed.getDynamicObject();
    const juce::String type = obj->getProperty("type").toString();

    if (type == "noteOn")
    {
        const double startTimeMs = obj->hasProperty("startTime") ? (double) obj->getProperty("startTime") : 0.0;
        if (startTimeMs > 0.0)
        {
            const juce::int64 dueTicks = hrAnchorTicks + (juce::int64) ((startTimeMs - epochAnchorMs) * hrTicksPerMs);
            if (dueTicks > juce::Time::getHighResolutionTicks() + (juce::int64) (hrTicksPerMs * 0.5))
            {
                const juce::ScopedLock sl(pendingNotesLock);
                pendingNotes.push_back({ parsed, dueTicks });
                if (!noteScheduler.isTimerRunning())
                    noteScheduler.startTimer(1);
                complete(true);
                return;
            }
        }
        OfflineRenderer::dispatchNoteOn(audioEngine, parsed);
    }
    else if (type == "noteOff")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const int noteId = obj->hasProperty("noteId") ? (int)obj->getProperty("noteId") : -1;
        audioEngine.noteOff(trackId, noteId);
    }
    else if (type == "allNotesOff")
    {
        cancelPendingNotes();
        const juce::String trackId = obj->hasProperty("trackId") ? obj->getProperty("trackId").toString() : juce::String();
        if (trackId.isNotEmpty())
            audioEngine.killAllNotesOnTrack(trackId);
        else
            audioEngine.allNotesOff();
    }
    else if (type == "play")
    {
        audioEngine.play();
    }
    else if (type == "stop")
    {
        audioEngine.stop();
    }
    else if (type == "setBpm")
    {
        audioEngine.setBpm((float)obj->getProperty("bpm"));
    }
    else if (type == "setMasterVolume")
    {
        audioEngine.setMasterVolume((float)obj->getProperty("volume"));
    }
    else if (type == "setMasterLimiter")
    {
        auto enabledProp = obj->getProperty("enabled");
        const bool enabled = enabledProp.isBool() ? (bool)enabledProp
                                                  : enabledProp.toString().toLowerCase() != "false";
        const float threshold = obj->hasProperty("threshold") ? (float)obj->getProperty("threshold") : -1.5f;
        audioEngine.setMasterLimiter(enabled, threshold);
    }
    else if (type == "setTrackFxChain")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String signature = obj->getProperty("signature").toString();
        auto effects = juce::JSON::parse(obj->getProperty("effects").toString());
        audioEngine.setTrackFxChain(trackId, signature, effects);
    }
    else if (type == "pruneNoteFxChains")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        audioEngine.pruneNoteFxChains(trackId, obj->getProperty("chainIds"));
    }
    else if (type == "openNoteFxVst3Editor")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const int chainId = (int)obj->getProperty("chainId");
        const int stepIndex = (int)obj->getProperty("stepIndex");
        audioEngine.openNoteFxVst3Editor(trackId, chainId, stepIndex);
        complete(true);
        return;
    }
    else if (type == "createTrack")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String instrument = obj->getProperty("instrument").toString();
        audioEngine.addTrack(trackId, instrument);
    }
    else if (type == "removeTrack")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        audioEngine.removeTrack(trackId);
    }
    else if (type == "clearAllTracks")
    {
        audioEngine.clearAllTracks();
    }
    else if (type == "setTrackParam")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String param = obj->getProperty("param").toString();
        auto valProp = obj->getProperty("value");

        if (param == "volume") audioEngine.setTrackVolume(trackId, (float)valProp);
        else if (param == "pan") audioEngine.setTrackPan(trackId, (float)valProp);
        else if (param == "muted") audioEngine.setTrackMute(trackId, (float)valProp > 0.5f);
        else if (param == "soloed") audioEngine.setTrackSolo(trackId, (float)valProp > 0.5f);
        else if (param == "instrument") audioEngine.setTrackInstrument(trackId, valProp.toString());
        else if (param == "synthPreset") audioEngine.setTrackSynthPreset(trackId, valProp.toString());
        else if (param == "oscType" || param == "synthOscillator")
        {
            if (valProp.isString())
            {
                juce::String s = valProp.toString().toLowerCase();
                float oscNum = 1.0f;
                if (s == "sine") oscNum = 0.0f;
                else if (s == "triangle") oscNum = 1.0f;
                else if (s == "square") oscNum = 2.0f;
                else if (s == "saw" || s == "sawtooth") oscNum = 3.0f;
                else if (s == "noise" || s == "custom") oscNum = 4.0f;
                audioEngine.setTrackSynthParam(trackId, "oscType", oscNum);
            }
            else
            {
                audioEngine.setTrackSynthParam(trackId, "oscType", (float)valProp);
            }
        }
        else audioEngine.setTrackSynthParam(trackId, param, (float)valProp);
    }
    else if (type == "setTrackInstrument")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String instrument = obj->getProperty("instrument").toString();
        audioEngine.setTrackInstrument(trackId, instrument);
    }
    else if (type == "setTrackPreset")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String preset = obj->getProperty("preset").toString();
        audioEngine.setTrackSynthPreset(trackId, preset);
    }
    else if (type == "setTrackFx")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String fxType = obj->getProperty("fxType").toString();
        const juce::String param = obj->getProperty("param").toString();
        const float val = (float)obj->getProperty("value");
        audioEngine.setTrackFxParam(trackId, fxType, param, val);
    }
    else if (type == "ensureNoteFxChain")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const int chainId = (int)obj->getProperty("chainId");
        const juce::String signature = obj->getProperty("signature").toString();
        auto effects = juce::JSON::parse(obj->getProperty("effects").toString());
        audioEngine.ensureNoteFxChain(trackId, chainId, signature, effects);
    }
    else if (type == "setTrackKit")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String kitName = obj->getProperty("kitName").toString();
        audioEngine.setTrackDrumKit(trackId, kitName);
    }
    else if (type == "setTrackSampler")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const bool enabled = (bool)obj->getProperty("enabled") || obj->getProperty("enabled").toString().toLowerCase() == "true";

        SampleEngine::Config cfg;
        auto getF = [&obj](const char* key, float fallback) -> float
        {
            if (!obj->hasProperty(key)) return fallback;
            const juce::var v = obj->getProperty(key);
            const double d = (double)v;
            return std::isfinite(d) ? (float)d : fallback;
        };
        cfg.rootNote    = (int)getF("rootNote", 60.0f);
        cfg.tuning      = getF("tuning", 0.0f);
        cfg.fineTune    = getF("fineTune", 0.0f);
        cfg.startOffset = getF("startOffset", 0.0f);
        cfg.endOffset   = getF("endOffset", 1.0f);
        cfg.loopStartOffset = getF("loopStartOffset", -1.0f);
        cfg.loopEndOffset   = getF("loopEndOffset", -1.0f);
        const juce::var loopModeVar = obj->getProperty("loopMode");
        cfg.loopMode = loopModeVar.isString()
            ? (loopModeVar.toString() == "releaseTail" ? 1 : 0)
            : (int)getF("loopMode", 0.0f);
        cfg.loop        = (bool)obj->getProperty("loop") || obj->getProperty("loop").toString().toLowerCase() == "true";
        cfg.reverse     = (bool)obj->getProperty("reverse") || obj->getProperty("reverse").toString().toLowerCase() == "true";
        cfg.attack      = getF("attack", 0.005f);
        cfg.decay       = getF("decay", 0.25f);
        cfg.sustain     = getF("sustain", 0.6f);
        cfg.release     = getF("release", 0.35f);
        cfg.volume      = getF("volume", 1.0f);
        cfg.pan         = getF("pan", 0.0f);

        const juce::String base64 = obj->hasProperty("audioBase64") ? obj->getProperty("audioBase64").toString() : juce::String();
        audioEngine.setTrackSampler(trackId, enabled, cfg, base64);
    }
    else if (type == "setTrackCurve")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String curveType = obj->getProperty("curveType").toString();
        const float tension = obj->hasProperty("tension") ? (float)obj->getProperty("tension") : 0.0f;
        if (obj->hasProperty("lut") && obj->getProperty("lut").isArray())
        {
            auto* arr = obj->getProperty("lut").getArray();
            std::vector<float> lut;
            lut.reserve(arr->size());
            for (auto& item : *arr) lut.push_back((float)item);
            audioEngine.setTrackDecayCurveLut(trackId, lut.data(), (int)lut.size());
        }
        else
        {
            audioEngine.setTrackDecayCurveType(trackId, curveType, tension);
        }
    }
    else if (type == "setPadCurve")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const int padIndex = (int)obj->getProperty("padIndex");
        if (obj->hasProperty("lut") && obj->getProperty("lut").isArray())
        {
            auto* arr = obj->getProperty("lut").getArray();
            std::vector<float> lut;
            lut.reserve(arr->size());
            for (auto& item : *arr) lut.push_back((float)item);
            audioEngine.setDrumPadDecayCurveLut(trackId, padIndex, lut.data(), (int)lut.size());
        }
        else if (obj->hasProperty("tension"))
        {
            audioEngine.setDrumPadTension(trackId, padIndex, (float)obj->getProperty("tension"));
        }
    }
    else if (type == "setTrackVst3Instrument")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String pluginId = obj->getProperty("pluginId").toString();
        bool ok = audioEngine.setTrackVst3Instrument(trackId, pluginId);
        complete(ok);
        return;
    }
    else if (type == "removeTrackVst3Instrument")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        audioEngine.removeTrackVst3Instrument(trackId);
        complete(true);
        return;
    }
    else if (type == "setTrackVst3Parameter")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const int index = (int)obj->getProperty("index");
        const float value = (float)(double)obj->getProperty("value");
        const float rampSeconds = (float)(double)obj->getProperty("rampSeconds");
        audioEngine.setTrackVst3Parameter(trackId, index, value, rampSeconds);
        complete(true);
        return;
    }
    else if (type == "ensureNoteVst3Instrument")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String pluginId = obj->getProperty("pluginId").toString();
        const juce::String instanceKey = obj->getProperty("instanceKey").toString();
        bool ok = audioEngine.ensureNoteVst3Instrument(trackId, pluginId, instanceKey);
        complete(ok);
        return;
    }
    else if (type == "releaseNoteVst3Instruments")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        audioEngine.releaseNoteVst3Instruments(trackId);
        complete(true);
        return;
    }
    else if (type == "pruneNoteVst3Instruments")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        audioEngine.pruneNoteVst3Instruments(trackId, obj->getProperty("instanceKeys"));
        complete(true);
        return;
    }
    else if (type == "openTrackVst3InstrumentEditor")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        audioEngine.openTrackVst3InstrumentEditor(trackId);
        complete(true);
        return;
    }
    else if (type == "openNoteVst3InstrumentEditor")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String instanceKey = obj->getProperty("instanceKey").toString();
        audioEngine.openNoteVst3InstrumentEditor(trackId, instanceKey);
        complete(true);
        return;
    }
    else if (type == "addTrackVst3Fx")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String fxId = obj->getProperty("fxId").toString();
        const juce::String pluginId = obj->getProperty("pluginId").toString();
        bool ok = audioEngine.addTrackVst3Fx(trackId, fxId, pluginId);
        complete(ok);
        return;
    }
    else if (type == "removeTrackVst3Fx")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String fxId = obj->getProperty("fxId").toString();
        audioEngine.removeTrackVst3Fx(trackId, fxId);
        complete(true);
        return;
    }
    else if (type == "setTrackVst3FxBypass")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String fxId = obj->getProperty("fxId").toString();
        auto bypassProp = obj->getProperty("bypassed");
        bool bypassed = (bool)bypassProp || bypassProp.toString().toLowerCase() == "true" || (int)bypassProp == 1;
        audioEngine.setTrackVst3FxBypass(trackId, fxId, bypassed);
        complete(true);
        return;
    }
    else if (type == "setTrackVst3FxWet")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String fxId = obj->getProperty("fxId").toString();
        float wet = (float)obj->getProperty("wet");
        audioEngine.setTrackVst3FxWet(trackId, fxId, wet);
        complete(true);
        return;
    }
    else if (type == "openTrackVst3FxEditor")
    {
        const juce::String trackId = obj->getProperty("trackId").toString();
        const juce::String fxId = obj->getProperty("fxId").toString();
        audioEngine.openTrackVst3FxEditor(trackId, fxId);
        complete(true);
        return;
    }
    else if (type == "openPreviewVst3Editor")
    {
        const juce::String pluginId = obj->getProperty("pluginId").toString();
        audioEngine.openStandaloneVst3Editor(pluginId);
        complete(true);
        return;
    }

    complete(true);
}

void JuceBridge::dispatchDueNotes()
{
    std::vector<juce::var> due;
    {
        const juce::ScopedLock sl(pendingNotesLock);
        const auto nowTicks = juce::Time::getHighResolutionTicks();
        for (auto it = pendingNotes.begin(); it != pendingNotes.end();)
        {
            if (it->dueTicks <= nowTicks)
            {
                due.push_back(std::move(it->command));
                it = pendingNotes.erase(it);
            }
            else
            {
                ++it;
            }
        }
        if (pendingNotes.empty())
            noteScheduler.stopTimer();
    }

    for (auto& command : due)
        OfflineRenderer::dispatchNoteOn(audioEngine, command);
}

void JuceBridge::cancelPendingNotes()
{
    const juce::ScopedLock sl(pendingNotesLock);
    pendingNotes.clear();
    noteScheduler.stopTimer();
}

void JuceBridge::handleVst3Scan(const juce::Array<juce::var>& /*args*/, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    audioEngine.getVst3Host().scanPluginsAsync(
        [](float /*prog*/, const juce::String& /*cur*/) {},
        [this, complete](int /*total*/) {
            auto pluginsVar = audioEngine.getVst3Host().getPluginListAsVar();
            complete(pluginsVar);
        }
    );
}

void JuceBridge::handleVst3GetPlugins(const juce::Array<juce::var>& /*args*/, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    auto pluginsVar = audioEngine.getVst3Host().getPluginListAsVar();
    complete(pluginsVar);
}

void JuceBridge::handleVst3OpenEditor(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (!args.isEmpty())
    {
        const juce::String pluginId = args[0].toString();
        audioEngine.openStandaloneVst3Editor(pluginId);
        complete(true);
        return;
    }
    complete(false);
}

void JuceBridge::handleGetAudioDeviceSetup(const juce::Array<juce::var>& /*args*/, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    auto& dm = audioEngine.getDeviceManager();
    const auto& availableTypes = dm.getAvailableDeviceTypes();

    juce::DynamicObject::Ptr res = new juce::DynamicObject();

    juce::Array<juce::var> typeNames;
    for (auto* type : availableTypes)
    {
        if (type != nullptr)
            typeNames.add(type->getTypeName());
    }
    res->setProperty("availableTypes", typeNames);
    res->setProperty("currentType", dm.getCurrentAudioDeviceType());

    auto* currentDevice = dm.getCurrentAudioDevice();
    auto setup = dm.getAudioDeviceSetup();

    res->setProperty("currentOutputDevice", setup.outputDeviceName);
    res->setProperty("sampleRate", setup.sampleRate);
    res->setProperty("bufferSize", setup.bufferSize);

    juce::Array<juce::var> outputDevices;
    if (auto* currentTypeObj = dm.getCurrentDeviceTypeObject())
    {
        currentTypeObj->scanForDevices();
        auto names = currentTypeObj->getDeviceNames(false);
        for (const auto& n : names)
            outputDevices.add(n);
    }
    res->setProperty("availableOutputDevices", outputDevices);

    juce::Array<juce::var> sampleRates;
    juce::Array<juce::var> bufferSizes;
    double latencyMs = 0.0;

    if (currentDevice != nullptr)
    {
        for (auto rate : currentDevice->getAvailableSampleRates())
            sampleRates.add(rate);

        for (auto size : currentDevice->getAvailableBufferSizes())
            bufferSizes.add(size);

        int outputLatencySamples = currentDevice->getOutputLatencyInSamples();
        if (setup.sampleRate > 0)
            latencyMs = (double)(setup.bufferSize + outputLatencySamples) * 1000.0 / setup.sampleRate;
    }

    if (sampleRates.isEmpty())
    {
        sampleRates.add(44100);
        sampleRates.add(48000);
        sampleRates.add(88200);
        sampleRates.add(96000);
    }

    if (bufferSizes.isEmpty())
    {
        bufferSizes.add(64);
        bufferSizes.add(128);
        bufferSizes.add(256);
        bufferSizes.add(512);
        bufferSizes.add(1024);
    }

    if (latencyMs <= 0.0 && setup.sampleRate > 0 && setup.bufferSize > 0)
    {
        latencyMs = (double)setup.bufferSize * 1000.0 / setup.sampleRate;
    }

    res->setProperty("availableSampleRates", sampleRates);
    res->setProperty("availableBufferSizes", bufferSizes);
    res->setProperty("latencyMs", latencyMs);

    complete(juce::var(res.get()));
}

void JuceBridge::handleSetAudioDeviceSetup(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
{
    if (args.isEmpty() || !args[0].isObject())
    {
        handleGetAudioDeviceSetup(args, complete);
        return;
    }

    auto* req = args[0].getDynamicObject();
    auto& dm = audioEngine.getDeviceManager();

    if (req->hasProperty("type"))
    {
        juce::String newType = req->getProperty("type").toString();
        if (newType.isNotEmpty() && newType != dm.getCurrentAudioDeviceType())
        {
            dm.setCurrentAudioDeviceType(newType, true);
        }
    }

    auto setup = dm.getAudioDeviceSetup();

    if (req->hasProperty("outputDevice"))
    {
        juce::String outDev = req->getProperty("outputDevice").toString();
        if (outDev.isNotEmpty())
            setup.outputDeviceName = outDev;
    }

    if (req->hasProperty("sampleRate"))
    {
        double sr = (double)req->getProperty("sampleRate");
        if (sr > 0) setup.sampleRate = sr;
    }

    if (req->hasProperty("bufferSize"))
    {
        int bs = (int)req->getProperty("bufferSize");
        if (bs > 0) setup.bufferSize = bs;
    }

    auto err = dm.setAudioDeviceSetup(setup, true);
    if (err.isNotEmpty())
    {
        juce::Logger::writeToLog("setAudioDeviceSetup: " + err);
    }

    handleGetAudioDeviceSetup(args, complete);
}
