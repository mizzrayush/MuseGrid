#include "Vst3Host.h"

Vst3Host::Vst3Host()
{
}

Vst3Host::~Vst3Host()
{
    if (scanThread != nullptr && scanThread->isThreadRunning())
    {
        scanThread->stopThread(3000);
    }
}

void Vst3Host::init()
{
    // Register VST3 format
    auto vst3 = std::make_unique<juce::VST3PluginFormat>();
    vst3Format = vst3.get();
    formatManager.addFormat(std::move(vst3));

    // Load any previously scanned plugin cache from AppData
    loadCache();
}

juce::File Vst3Host::getCacheFile() const
{
    auto appData = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);
    auto dir = appData.getChildFile("MuseGrid");
    if (!dir.exists())
    {
        dir.createDirectory();
    }
    return dir.getChildFile("vst3_plugins.xml");
}

juce::File Vst3Host::getDeadMansPedalFile() const
{
    auto appData = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);
    auto dir = appData.getChildFile("MuseGrid");
    if (!dir.exists())
    {
        dir.createDirectory();
    }
    return dir.getChildFile("vst3_dead_mans_pedal.txt");
}

void Vst3Host::saveCache()
{
    auto cacheFile = getCacheFile();
    if (auto xml = knownPluginList.createXml())
    {
        xml->writeTo(cacheFile);
    }
}

void Vst3Host::loadCache()
{
    auto cacheFile = getCacheFile();
    if (cacheFile.existsAsFile())
    {
        if (auto xml = juce::XmlDocument::parse(cacheFile))
        {
            knownPluginList.recreateFromXml(*xml);
            knownPluginList.clearBlacklistedFiles();
        }
    }
}

void Vst3Host::scanPluginsSync()
{
    if (vst3Format == nullptr) return;

    scanning = true;

    juce::FileSearchPath searchPath = vst3Format->getDefaultLocationsToSearch();

    // Also add explicit standard 64-bit VST3 paths on Windows if not already present
    juce::File commonVst3("C:\\Program Files\\Common Files\\VST3");
    if (commonVst3.isDirectory())
    {
        searchPath.add(commonVst3);
    }
    juce::File localVst3 = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                                .getChildFile("..\\Local\\Programs\\Common\\VST3");
    if (localVst3.isDirectory())
    {
        searchPath.add(localVst3);
    }

    auto pedalFile = getDeadMansPedalFile();
    juce::PluginDirectoryScanner scanner(knownPluginList, *vst3Format, searchPath, true, pedalFile);

    juce::String pluginBeingScanned;
    while (scanner.scanNextFile(true, pluginBeingScanned))
    {
    }

    saveCache();
    scanning = false;
}

#if JUCE_WINDOWS
#include <excpt.h>
static inline bool safeScanNextPlugin(juce::PluginDirectoryScanner& scanner, juce::String& nextPlugin)
{
    __try
    {
        return scanner.scanNextFile(true, nextPlugin);
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}
#else
static inline bool safeScanNextPlugin(juce::PluginDirectoryScanner& scanner, juce::String& nextPlugin)
{
    try { return scanner.scanNextFile(true, nextPlugin); } catch (...) { return false; }
}
#endif

class Vst3ScannerThread : public juce::Thread
{
public:
    Vst3ScannerThread(juce::KnownPluginList& list,
                      juce::AudioPluginFormat& format,
                      juce::File pedalFile,
                      std::function<void(float, const juce::String&)> progressCb,
                      std::function<void(int)> completeCb,
                      std::function<void()> onDone)
        : Thread("MuseGrid_VST3_Scanner"),
          knownList(list),
          pluginFormat(format),
          pedal(pedalFile),
          progressCallback(progressCb),
          completeCallback(completeCb),
          doneCallback(onDone)
    {
    }

    void run() override
    {
        juce::FileSearchPath searchPath = pluginFormat.getDefaultLocationsToSearch();
        juce::File commonVst3("C:\\Program Files\\Common Files\\VST3");
        if (commonVst3.isDirectory())
        {
            searchPath.add(commonVst3);
        }

        juce::PluginDirectoryScanner scanner(knownList, pluginFormat, searchPath, true, pedal);
        juce::String nextPlugin;

        while (!threadShouldExit())
        {
            float prog = scanner.getProgress();
            if (!safeScanNextPlugin(scanner, nextPlugin))
                break;

            if (progressCallback)
            {
                juce::MessageManager::callAsync([cb = progressCallback, prog, nextPlugin]() {
                    cb(prog, nextPlugin);
                });
            }
        }

        int total = knownList.getNumTypes();
        if (completeCallback)
        {
            juce::MessageManager::callAsync([cb = completeCallback, total]() {
                cb(total);
            });
        }
        if (doneCallback)
        {
            juce::MessageManager::callAsync([cb = doneCallback]() {
                cb();
            });
        }
    }

private:
    juce::KnownPluginList& knownList;
    juce::AudioPluginFormat& pluginFormat;
    juce::File pedal;
    std::function<void(float, const juce::String&)> progressCallback;
    std::function<void(int)> completeCallback;
    std::function<void()> doneCallback;
};

void Vst3Host::scanPluginsAsync(std::function<void(float, const juce::String&)> progressCallback,
                                std::function<void(int)> completeCallback)
{
    if (scanning || vst3Format == nullptr) return;
    scanning = true;

    auto thread = std::make_unique<Vst3ScannerThread>(
        knownPluginList,
        *vst3Format,
        getDeadMansPedalFile(),
        progressCallback,
        completeCallback,
        [this]() {
            saveCache();
            scanning = false;
        });

    thread->startThread(juce::Thread::Priority::normal);
    scanThread = std::move(thread);
}

juce::var Vst3Host::getPluginListAsVar() const
{
    juce::Array<juce::var> list;
    auto types = knownPluginList.getTypes();

    for (const auto& desc : types)
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("name", desc.name);
        obj->setProperty("descriptiveName", desc.descriptiveName);
        obj->setProperty("pluginFormatName", desc.pluginFormatName);
        obj->setProperty("category", desc.category);
        obj->setProperty("manufacturerName", desc.manufacturerName);
        obj->setProperty("version", desc.version);
        obj->setProperty("isInstrument", desc.isInstrument);
        obj->setProperty("fileOrIdentifier", desc.fileOrIdentifier);
        obj->setProperty("uniqueId", juce::String(desc.uniqueId));
        obj->setProperty("uniqueIdHex", juce::String::toHexString(desc.uniqueId));
        obj->setProperty("numInputChannels", desc.numInputChannels);
        obj->setProperty("numOutputChannels", desc.numOutputChannels);

        list.add(juce::var(obj));
    }

    return juce::var(list);
}

static juce::File resolveVst3Binary(const juce::File& fileOrDir)
{
    if (fileOrDir.existsAsFile())
        return fileOrDir;

    if (fileOrDir.isDirectory())
    {
        auto x64Dir = fileOrDir.getChildFile("Contents").getChildFile("x86_64-win");
        if (x64Dir.isDirectory())
        {
            auto matches = x64Dir.findChildFiles(juce::File::findFiles, false, "*.vst3");
            if (!matches.isEmpty()) return matches[0];
            auto dllMatches = x64Dir.findChildFiles(juce::File::findFiles, false, "*.dll");
            if (!dllMatches.isEmpty()) return dllMatches[0];
        }
        auto contents = fileOrDir.getChildFile("Contents");
        if (contents.isDirectory())
        {
            auto matches = contents.findChildFiles(juce::File::findFiles, true, "*.vst3;*.dll");
            if (!matches.isEmpty()) return matches[0];
        }
    }
    return fileOrDir;
}

std::unique_ptr<juce::PluginDescription> Vst3Host::findDescription(const juce::String& identifierOrName) const
{
    auto types = knownPluginList.getTypes();
    auto makeDescCopy = [](const juce::PluginDescription& src) {
        auto copy = std::make_unique<juce::PluginDescription>(src);
        juce::File resolved = resolveVst3Binary(juce::File(copy->fileOrIdentifier));
        copy->fileOrIdentifier = resolved.getFullPathName();
        return copy;
    };

    // 1. Direct file path or identifier match (case-insensitive on Windows)
    for (const auto& desc : types)
    {
        if (desc.fileOrIdentifier.equalsIgnoreCase(identifierOrName))
            return makeDescCopy(desc);
    }
    // 2. ID match (decimal string or hex string)
    for (const auto& desc : types)
    {
        if (juce::String(desc.uniqueId) == identifierOrName ||
            juce::String::toHexString(desc.uniqueId).equalsIgnoreCase(identifierOrName) ||
            juce::String::toHexString((uint32_t)desc.uniqueId).equalsIgnoreCase(identifierOrName))
        {
            return makeDescCopy(desc);
        }
    }
    // 3. Name or descriptive name match
    for (const auto& desc : types)
    {
        if (desc.name.equalsIgnoreCase(identifierOrName) ||
            desc.descriptiveName.equalsIgnoreCase(identifierOrName))
        {
            return makeDescCopy(desc);
        }
    }
    // 4. File name / base name match
    for (const auto& desc : types)
    {
        juce::File f(desc.fileOrIdentifier);
        if (f.getFileName().equalsIgnoreCase(identifierOrName) ||
            f.getFileNameWithoutExtension().equalsIgnoreCase(identifierOrName))
        {
            return makeDescCopy(desc);
        }
    }
    return nullptr;
}

#if JUCE_WINDOWS
#include <excpt.h>

struct SehConfigArgs
{
    juce::AudioPluginInstance* instance = nullptr;
    double sr = 44100.0;
    int maxBlock = 2048;
};

static void doConfigureInstance(SehConfigArgs* args)
{
    try
    {
        args->instance->setRateAndBufferSizeDetails(args->sr, args->maxBlock);
        args->instance->prepareToPlay(args->sr, args->maxBlock);
    }
    catch (...)
    {
        juce::Logger::writeToLog("[VST3 Host] Warning: C++ exception during configurePluginInstance prepareToPlay");
    }
}

static bool runConfigureWithSeh(void (*fn)(SehConfigArgs*), SehConfigArgs* args)
{
    __try
    {
        fn(args);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

static void configurePluginInstance(juce::AudioPluginInstance* instance, double sr, int maxBlock)
{
    if (instance == nullptr) return;

    SehConfigArgs args;
    args.instance = instance;
    args.sr = sr;
    args.maxBlock = maxBlock;

    if (!runConfigureWithSeh(&doConfigureInstance, &args))
    {
        juce::Logger::writeToLog("[VST3 Host] Intercepted SEH crash during configurePluginInstance prepareToPlay: " + instance->getName());
    }
}

struct SehPluginArgs
{
    juce::AudioPluginFormatManager* fmgr = nullptr;
    juce::VST3PluginFormat* fmt = nullptr;
    const juce::PluginDescription* desc = nullptr;
    double sr = 44100.0;
    int maxBlock = 2048;
    juce::String* errOut = nullptr;
    juce::AudioPluginInstance* result = nullptr;
};

static void doCreatePluginInstance(SehPluginArgs* args)
{
    try
    {
        auto inst = args->fmgr->createPluginInstance(*args->desc, args->sr, args->maxBlock, *args->errOut);
        args->result = inst.release();
    }
    catch (const std::exception& e)
    {
        if (args->errOut != nullptr)
            *args->errOut = juce::String("C++ exception: ") + e.what();
        args->result = nullptr;
    }
    catch (...)
    {
        if (args->errOut != nullptr)
            *args->errOut = "Unknown C++ exception during createPluginInstance";
        args->result = nullptr;
    }
}

static void doCreateInstanceFromDesc(SehPluginArgs* args)
{
    try
    {
        auto inst = args->fmt->createInstanceFromDescription(*args->desc, args->sr, args->maxBlock, *args->errOut);
        args->result = inst.release();
    }
    catch (const std::exception& e)
    {
        if (args->errOut != nullptr)
            *args->errOut = juce::String("C++ exception: ") + e.what();
        args->result = nullptr;
    }
    catch (...)
    {
        if (args->errOut != nullptr)
            *args->errOut = "Unknown C++ exception during createInstanceFromDescription";
        args->result = nullptr;
    }
}

// Pure SEH invocation wrapper — NO C++ objects with destructors in this function frame!
static bool runPluginWithSeh(void (*fn)(SehPluginArgs*), SehPluginArgs* args)
{
    __try
    {
        fn(args);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

static std::unique_ptr<juce::AudioPluginInstance> safeCreatePluginInstance(
    juce::AudioPluginFormatManager& fmgr,
    const juce::PluginDescription& desc, double sr, int maxBlock, juce::String& errOut)
{
    SehPluginArgs args;
    args.fmgr = &fmgr;
    args.desc = &desc;
    args.sr = sr;
    args.maxBlock = maxBlock;
    args.errOut = &errOut;
    args.result = nullptr;

    if (!runPluginWithSeh(&doCreatePluginInstance, &args))
    {
        errOut = "Native crash / SEH exception intercepted during VST3 plugin instantiation";
        juce::Logger::writeToLog("[VST3 Host] " + errOut + ": " + desc.name);
        return nullptr;
    }

    return std::unique_ptr<juce::AudioPluginInstance>(args.result);
}

static std::unique_ptr<juce::AudioPluginInstance> safeCreateInstanceFromDesc(
    juce::VST3PluginFormat* fmt,
    const juce::PluginDescription& desc, double sr, int maxBlock, juce::String& errOut)
{
    SehPluginArgs args;
    args.fmt = fmt;
    args.desc = &desc;
    args.sr = sr;
    args.maxBlock = maxBlock;
    args.errOut = &errOut;
    args.result = nullptr;

    if (!runPluginWithSeh(&doCreateInstanceFromDesc, &args))
    {
        errOut = "Native crash / SEH exception intercepted during VST3 fallback instantiation";
        juce::Logger::writeToLog("[VST3 Host] " + errOut + ": " + desc.name);
        return nullptr;
    }

    return std::unique_ptr<juce::AudioPluginInstance>(args.result);
}

struct SehEditorArgs
{
    juce::AudioPluginInstance* plugin = nullptr;
    juce::AudioProcessorEditor* result = nullptr;
};

static void doCreatePluginEditor(SehEditorArgs* args)
{
    try
    {
        if (args->plugin != nullptr && args->plugin->hasEditor())
            args->result = args->plugin->createEditorAndMakeActive();
    }
    catch (...)
    {
        args->result = nullptr;
    }

    if (args->result == nullptr && args->plugin != nullptr)
    {
        try
        {
            args->result = new juce::GenericAudioProcessorEditor(*args->plugin);
        }
        catch (...)
        {
            args->result = nullptr;
        }
    }
}

static bool runEditorWithSeh(void (*fn)(SehEditorArgs*), SehEditorArgs* args)
{
    __try
    {
        fn(args);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}

juce::AudioProcessorEditor* safeCreatePluginEditor(juce::AudioPluginInstance* plugin)
{
    if (plugin == nullptr) return nullptr;

    SehEditorArgs args;
    args.plugin = plugin;
    args.result = nullptr;

    if (!runEditorWithSeh(&doCreatePluginEditor, &args))
    {
        juce::Logger::writeToLog("[VST3 Host] Intercepted SEH crash during plugin GUI editor creation");
        return nullptr;
    }

    return args.result;
}
#else
static void configurePluginInstance(juce::AudioPluginInstance* instance, double sr, int maxBlock)
{
    if (instance == nullptr) return;

    try
    {
        instance->enableAllBuses();
        instance->setRateAndBufferSizeDetails(sr, maxBlock);
        instance->prepareToPlay(sr, maxBlock);
    }
    catch (...)
    {
        juce::Logger::writeToLog("[VST3 Host] Warning: Exception during configurePluginInstance prepareToPlay");
    }
}

static std::unique_ptr<juce::AudioPluginInstance> safeCreatePluginInstance(
    juce::AudioPluginFormatManager& fmgr,
    const juce::PluginDescription& desc, double sr, int maxBlock, juce::String& errOut)
{
    try { return fmgr.createPluginInstance(desc, sr, maxBlock, errOut); }
    catch (...) { errOut = "Exception during createPluginInstance"; return nullptr; }
}

static std::unique_ptr<juce::AudioPluginInstance> safeCreateInstanceFromDesc(
    juce::VST3PluginFormat* fmt,
    const juce::PluginDescription& desc, double sr, int maxBlock, juce::String& errOut)
{
    try { return fmt->createInstanceFromDescription(desc, sr, maxBlock, errOut); }
    catch (...) { errOut = "Exception during createInstanceFromDescription"; return nullptr; }
}

juce::AudioProcessorEditor* safeCreatePluginEditor(juce::AudioPluginInstance* plugin)
{
    if (plugin == nullptr) return nullptr;
    juce::AudioProcessorEditor* ed = nullptr;
    try
    {
        if (plugin->hasEditor())
            ed = plugin->createEditorAndMakeActive();
    }
    catch (...)
    {
        ed = nullptr;
    }

    if (ed == nullptr)
    {
        try
        {
            ed = new juce::GenericAudioProcessorEditor(*plugin);
        }
        catch (...)
        {
            ed = nullptr;
        }
    }
    return ed;
}
#endif

std::unique_ptr<juce::AudioPluginInstance> Vst3Host::instantiatePlugin(const juce::PluginDescription& desc,
                                                                       double sampleRate,
                                                                       int blockSize,
                                                                       juce::String& errorMessage)
{
    int maxBlock = std::max(blockSize, 2048);
    double sr = sampleRate > 8000.0 ? sampleRate : 44100.0;

    // 1. First attempt: standard createPluginInstance from formatManager (SEH-protected)
    auto instance = safeCreatePluginInstance(formatManager, desc, sr, maxBlock, errorMessage);
    if (instance != nullptr)
    {
        configurePluginInstance(instance.get(), sr, maxBlock);
        return instance;
    }

    juce::Logger::writeToLog("[VST3 Host] Primary instantiation failed: " + errorMessage + " — trying fallback.");

    // 2. Fallback: If cached XML description failed (e.g. UID mismatch),
    // query the file directly on disk using vst3Format->findAllTypesForFile to obtain live descriptions!
    if (vst3Format != nullptr && desc.fileOrIdentifier.isNotEmpty())
    {
        juce::OwnedArray<juce::PluginDescription> liveDescs;
        vst3Format->findAllTypesForFile(liveDescs, desc.fileOrIdentifier);
        for (const auto* liveDesc : liveDescs)
        {
            if (liveDesc == nullptr) continue;
            juce::String liveErr;
            instance = safeCreateInstanceFromDesc(vst3Format, *liveDesc, sr, maxBlock, liveErr);
            if (instance != nullptr)
            {
                configurePluginInstance(instance.get(), sr, maxBlock);
                errorMessage = "";
                return instance;
            }
        }
    }

    return nullptr;
}

std::unique_ptr<juce::AudioPluginInstance> Vst3Host::instantiatePlugin(const juce::String& identifierOrName,
                                                                       double sampleRate,
                                                                       int blockSize,
                                                                       juce::String& errorMessage)
{
    auto desc = findDescription(identifierOrName);
    if (desc != nullptr)
    {
        auto inst = instantiatePlugin(*desc, sampleRate, blockSize, errorMessage);
        if (inst != nullptr)
            return inst;
    }

    // Direct file path fallback if identifierOrName is an existing path or DLL or bundle directory
    juce::File candidateFile = resolveVst3Binary(juce::File(identifierOrName));
    if (candidateFile.exists() && vst3Format != nullptr)
    {
        int maxBlock = std::max(blockSize, 512);
        double sr = sampleRate > 8000.0 ? sampleRate : 44100.0;
        juce::OwnedArray<juce::PluginDescription> liveDescs;
        vst3Format->findAllTypesForFile(liveDescs, candidateFile.getFullPathName());
        for (const auto* liveDesc : liveDescs)
        {
            if (liveDesc == nullptr) continue;
            juce::String liveErr;
            auto inst = safeCreateInstanceFromDesc(vst3Format, *liveDesc, sr, maxBlock, liveErr);
            if (inst != nullptr)
            {
                configurePluginInstance(inst.get(), sr, maxBlock);
                errorMessage = "";
                return inst;
            }
        }
    }

    if (desc == nullptr)
        errorMessage = "Plugin not found: " + identifierOrName;
    return nullptr;
}
