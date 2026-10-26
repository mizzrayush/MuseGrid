#include "AudioEngine.h"
#include <functional>
#include <set>
#include <cmath>

namespace
{
using FxParam = std::function<float(const char*, float)>;

void configureBuiltinFx(TrackState::NoteFxStep& step, const juce::String& type,
                        const FxParam& param, double sampleRate, int blockSize,
                        bool dpreverbApproximation)
{
    if (type == "eq")
    {
        step.eq = std::make_unique<EQEffect>();
        step.eq->prepare(sampleRate, blockSize);
        step.eq->setLowGainDb(param("lowGain", 0.0f));
        step.eq->setMidGainDb(param("midGain", 0.0f));
        step.eq->setHighGainDb(param("highGain", 0.0f));
    }
    else if (type == "filter")
    {
        step.filter = std::make_unique<FilterEffect>();
        step.filter->prepare(sampleRate, blockSize);
        step.filter->setCutoff(param("cutoff", param("frequency", 20000.0f)));
        step.filter->setResonance(param("resonance", param("Q", 0.7f)));
    }
    else if (type == "distortion")
    {
        step.distortion = std::make_unique<DistortionEffect>();
        step.distortion->prepare(sampleRate, blockSize);
        step.distortion->setDrive(param("amount", param("drive", 0.4f)));
        step.distortion->setMix(param("wet", param("mix", 0.0f)));
    }
    else if (type == "bitcrush" || type == "bitcrusher" || type == "custom-bitcrusher")
    {
        step.bitcrush = std::make_unique<BitcrushEffect>();
        step.bitcrush->prepare(sampleRate, blockSize);
        step.bitcrush->setDrive(param("drive", 1.5f));
        step.bitcrush->setBits(param("bits", 8.0f));
        step.bitcrush->setDive(param("dive", 0.5f));
        step.bitcrush->setMix(param("wet", param("mix", 0.0f)));
    }
    else if (type == "chorus")
    {
        step.chorus = std::make_unique<ChorusEffect>();
        step.chorus->prepare(sampleRate, blockSize);
        step.chorus->setWet(param("wet", 0.0f));
        step.chorus->setRate(param("frequency", 1.5f));
        step.chorus->setDepth(param("depth", 0.7f));
        step.chorus->setDelayTime(param("delayTime", 3.5f));
    }
    else if (type == "phaser")
    {
        step.phaser = std::make_unique<PhaserEffect>();
        step.phaser->prepare(sampleRate, blockSize);
        step.phaser->setWet(param("wet", 0.0f));
        step.phaser->setRate(param("frequency", 0.5f));
        step.phaser->setBaseFrequency(param("baseFreq", 350.0f));
        step.phaser->setOctaves(param("octaves", 3.0f));
    }
    else if (type == "delay")
    {
        step.delay = std::make_unique<DelayEffect>();
        step.delay->prepare(sampleRate, blockSize);
        step.delay->setTime(param("time", 0.25f));
        step.delay->setFeedback(param("feedback", 0.25f));
        step.delay->setWet(param("wet", 0.0f));
    }
    else if (type == "dpreverb")
    {
        step.dpreverb = std::make_unique<ReverbEffect>();
        step.dpreverb->prepare(sampleRate, blockSize);
        step.dpreverb->setWet(param("wet", 0.0f));
        const float tail = juce::jlimit(0.0f, 120.0f, param("tail", 2.0f));
        const float shape = juce::jlimit(0.05f, 1.0f, param("decay", 0.65f));
        const float tone = juce::jlimit(0.0f, 1.0f, param("tone", 0.55f));
        step.dpreverb->setPreDelay(juce::jlimit(0.0f, 1.0f, tail * 0.25f));
        step.dpreverb->setRoomSize(juce::jlimit(0.05f, 0.98f, 0.35f + shape * 0.6f));
        step.dpreverb->setDamping(juce::jlimit(0.0f, 1.0f, 1.0f - tone));
        if (dpreverbApproximation)
            juce::Logger::writeToLog("[AudioEngine] DPreverb rendered as a pre-delayed reverb (native)");
    }
    else if (type == "reverb")
    {
        step.reverb = std::make_unique<ReverbEffect>();
        step.reverb->prepare(sampleRate, blockSize);
        step.reverb->setWet(param("wet", 0.0f));
        const float decay = juce::jlimit(0.1f, 30.0f, param("decay", 2.5f));
        const float room = param("roomSize", juce::jlimit(0.05f, 0.98f, decay / 10.0f));
        step.reverb->setRoomSize(juce::jlimit(0.05f, 0.98f, room));
        step.reverb->setDamping(param("damping", 0.5f));
        step.reverb->setPreDelay(param("preDelay", 0.01f));
    }
    else if (type == "freeverb")
    {
        step.freeverb = std::make_unique<ReverbEffect>();
        step.freeverb->prepare(sampleRate, blockSize);
        step.freeverb->setWet(param("wet", 0.0f));
        step.freeverb->setRoomSize(param("roomSize", 0.7f));
        const float damp = param("dampening", param("damping", 4000.0f));
        step.freeverb->setDamping(damp > 1.0f ? juce::jlimit(0.0f, 1.0f, damp / 10000.0f) : damp);
    }
}
}

AudioEngine::AudioEngine()
{
    juce::Logger::writeToLog("[AudioEngine::AudioEngine] Constructor entered.");
}

AudioEngine::~AudioEngine()
{
    shutdown();
}

bool AudioEngine::init()
{
    juce::Logger::writeToLog("[AudioEngine::init] Starting deviceManager.initialise...");
    // Initialise audio device with stereo output, 0 inputs
    auto error = deviceManager.initialise(0, 2, nullptr, true);
    if (!error.isEmpty())
    {
        juce::Logger::writeToLog("Audio device init failed: " + error);
        return false;
    }

    juce::Logger::writeToLog("[AudioEngine::init] Device initialised. Adding callback...");
    deviceManager.addAudioCallback(this);

    // Initialise VST3 plugin host system
    vst3Host.init();

    juce::Logger::writeToLog("[AudioEngine::init] Complete.");
    return true;
}

void AudioEngine::shutdown()
{
    deviceManager.removeAudioCallback(this);
    deviceManager.closeAudioDevice();
}

void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* device)
{
    prepareForRate(device != nullptr ? device->getCurrentSampleRate() : 44100.0,
                   device != nullptr ? device->getCurrentBufferSizeSamples() : 512);
}

void AudioEngine::prepareForRate(double sampleRate, int blockSize)
{
    currentSampleRate = sampleRate;
    currentBlockSize = blockSize;

    voiceManager.prepare(currentSampleRate);
    masterLimiter.prepare(currentSampleRate, currentBlockSize);

    trackBuffer.setSize(2, 4096);
    fxWetBuffer.setSize(2, 4096);
    vst3InstBuffer.setSize(2, 4096);
    masterBuffer.setSize(2, 4096);
    noteFxBuffer.setSize(2, 4096);
    noteFxMixBuffer.setSize(2, 4096);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        t->eq.prepare(currentSampleRate, currentBlockSize);
        t->filter.prepare(currentSampleRate, currentBlockSize);
        t->distortion.prepare(currentSampleRate, currentBlockSize);
        t->bitcrush.prepare(currentSampleRate, currentBlockSize);
        t->chorus.prepare(currentSampleRate, currentBlockSize);
        t->phaser.prepare(currentSampleRate, currentBlockSize);
        t->delay.prepare(currentSampleRate, currentBlockSize);
        t->dpreverb.prepare(currentSampleRate, currentBlockSize);
        t->reverb.prepare(currentSampleRate, currentBlockSize);
        t->freeverb.prepare(currentSampleRate, currentBlockSize);
        t->drumEngine.prepare(currentSampleRate);
        t->sampleEngine.prepare(currentSampleRate);

        if (t->vst3Instrument != nullptr)
        {
            try
            {
                t->vst3Instrument->enableAllBuses();
                t->vst3Instrument->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                t->vst3Instrument->prepareToPlay(currentSampleRate, currentBlockSize);
            }
            catch (...)
            {
                juce::Logger::writeToLog("[AudioEngine] Warning: VST3 instrument prepareToPlay failed on track " + t->id);
            }
        }
        for (auto& slot : t->noteVst3Slots)
        {
            if (slot->plugin == nullptr) continue;
            try
            {
                slot->plugin->enableAllBuses();
                slot->plugin->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                slot->plugin->prepareToPlay(currentSampleRate, currentBlockSize);
            }
            catch (...)
            {
                juce::Logger::writeToLog("[AudioEngine] Warning: per-note VST3 prepareToPlay failed for " + slot->identifier);
            }
        }
        for (auto& fx : t->vst3FxChain)
        {
            if (fx->plugin != nullptr)
            {
                try
                {
                    fx->plugin->enableAllBuses();
                    fx->plugin->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                    fx->plugin->prepareToPlay(currentSampleRate, currentBlockSize);
                }
                catch (...)
                {
                    juce::Logger::writeToLog("[AudioEngine] Warning: VST3 FX prepareToPlay failed: " + fx->pluginName);
                }
            }
        }

        for (auto& chainEntry : t->noteFxChains)
        {
            for (auto& step : chainEntry.second->steps)
            {
                if (step->eq) step->eq->prepare(currentSampleRate, currentBlockSize);
                if (step->filter) step->filter->prepare(currentSampleRate, currentBlockSize);
                if (step->distortion) step->distortion->prepare(currentSampleRate, currentBlockSize);
                if (step->bitcrush) step->bitcrush->prepare(currentSampleRate, currentBlockSize);
                if (step->chorus) step->chorus->prepare(currentSampleRate, currentBlockSize);
                if (step->phaser) step->phaser->prepare(currentSampleRate, currentBlockSize);
                if (step->delay) step->delay->prepare(currentSampleRate, currentBlockSize);
                if (step->dpreverb) step->dpreverb->prepare(currentSampleRate, currentBlockSize);
                if (step->reverb) step->reverb->prepare(currentSampleRate, currentBlockSize);
                if (step->freeverb) step->freeverb->prepare(currentSampleRate, currentBlockSize);
                if (step->vst3 != nullptr)
                {
                    try
                    {
                        step->vst3->enableAllBuses();
                        step->vst3->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                        step->vst3->prepareToPlay(currentSampleRate, currentBlockSize);
                    }
                    catch (...)
                    {
                        juce::Logger::writeToLog("[AudioEngine] Warning: note FX VST3 prepare failed: " + step->pluginName);
                    }
                }
            }
        }

        for (auto& step : t->fxRack)
        {
            if (step->eq) step->eq->prepare(currentSampleRate, currentBlockSize);
            if (step->filter) step->filter->prepare(currentSampleRate, currentBlockSize);
            if (step->distortion) step->distortion->prepare(currentSampleRate, currentBlockSize);
            if (step->bitcrush) step->bitcrush->prepare(currentSampleRate, currentBlockSize);
            if (step->chorus) step->chorus->prepare(currentSampleRate, currentBlockSize);
            if (step->phaser) step->phaser->prepare(currentSampleRate, currentBlockSize);
            if (step->delay) step->delay->prepare(currentSampleRate, currentBlockSize);
            if (step->dpreverb) step->dpreverb->prepare(currentSampleRate, currentBlockSize);
            if (step->reverb) step->reverb->prepare(currentSampleRate, currentBlockSize);
            if (step->freeverb) step->freeverb->prepare(currentSampleRate, currentBlockSize);
            if (step->vst3 != nullptr)
            {
                try
                {
                    step->vst3->enableAllBuses();
                    step->vst3->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                    step->vst3->prepareToPlay(currentSampleRate, currentBlockSize);
                }
                catch (...)
                {
                    juce::Logger::writeToLog("[AudioEngine] Warning: track FX VST3 prepare failed: " + step->pluginName);
                }
            }
        }
    }
}

void AudioEngine::setMasterLimiter(bool enabled, float thresholdDb)
{
    masterLimiter.setEnabled(enabled);
    masterLimiter.setCeiling(thresholdDb);
}

void AudioEngine::audioDeviceStopped()
{
    voiceManager.reset();
    masterLimiter.reset();
}

void AudioEngine::play()
{
    playing = true;
}

void AudioEngine::stop()
{
    playing = false;
    allNotesOff();
}

void AudioEngine::addTrack(const juce::String& trackId, const juce::String& instrument)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (const auto& t : tracks)
    {
        if (t->id == trackId)
        {
            t->instrument = instrument;
            return;
        }
    }

    auto newTrack = std::make_unique<TrackState>();
    newTrack->id = trackId;
    newTrack->instrument = instrument;
    newTrack->eq.prepare(currentSampleRate, currentBlockSize);
    newTrack->filter.prepare(currentSampleRate, currentBlockSize);
    newTrack->distortion.prepare(currentSampleRate, currentBlockSize);
    newTrack->bitcrush.prepare(currentSampleRate, currentBlockSize);
    newTrack->chorus.prepare(currentSampleRate, currentBlockSize);
    newTrack->phaser.prepare(currentSampleRate, currentBlockSize);
    newTrack->delay.prepare(currentSampleRate, currentBlockSize);
    newTrack->dpreverb.prepare(currentSampleRate, currentBlockSize);
    newTrack->reverb.prepare(currentSampleRate, currentBlockSize);
    newTrack->freeverb.prepare(currentSampleRate, currentBlockSize);
    newTrack->drumEngine.prepare(currentSampleRate);
    newTrack->sampleEngine.prepare(currentSampleRate);

    tracks.push_back(std::move(newTrack));
}

void AudioEngine::setTrackInstrument(const juce::String& trackId, const juce::String& instrument)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            t->instrument = instrument;
            break;
        }
    }
}

void AudioEngine::removeTrack(const juce::String& trackId)
{
    voiceManager.killAllNotesOnTrack(trackId);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto it = tracks.begin(); it != tracks.end(); ++it)
    {
        if ((*it)->id == trackId)
        {
            (*it)->vst3InstrumentEditor = nullptr;
            (*it)->vst3Instrument = nullptr;
            (*it)->vst3FxChain.clear();
            tracks.erase(it);
            break;
        }
    }
}

void AudioEngine::clearAllTracks()
{
    voiceManager.allNotesOff();

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        t->vst3InstrumentEditor = nullptr;
        t->vst3Instrument = nullptr;
        t->vst3InstrumentIdentifier = "";
        t->vst3InstrumentName = "";
        t->vst3FxChain.clear();
    }
    tracks.clear();
}

void AudioEngine::setTrackVolume(const juce::String& trackId, float vol)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->volume = juce::jlimit(0.0f, 2.0f, vol); break; }
    }
}

void AudioEngine::setTrackPan(const juce::String& trackId, float pan)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->pan = juce::jlimit(-1.0f, 1.0f, pan); break; }
    }
}

void AudioEngine::setTrackMute(const juce::String& trackId, bool mute)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->muted = mute; break; }
    }
}

void AudioEngine::setTrackSolo(const juce::String& trackId, bool solo)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->soloed = solo; break; }
    }
}

bool AudioEngine::getTrackMute(const juce::String& trackId)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
        if (t->id == trackId) return t->muted;
    return false;
}

bool AudioEngine::getTrackSolo(const juce::String& trackId)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
        if (t->id == trackId) return t->soloed;
    return false;
}

void AudioEngine::setTrackSynthParam(const juce::String& trackId, const juce::String& param, float val)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            if (param == "oscType" || param == "synthOscillator") {
                int type = (int)val;
                if (type == 0) t->oscType = SynthVoice::OscType::Sine;
                else if (type == 1) t->oscType = SynthVoice::OscType::Triangle;
                else if (type == 2) t->oscType = SynthVoice::OscType::Square;
                else if (type == 3) t->oscType = SynthVoice::OscType::Saw;
                else if (type == 4) t->oscType = SynthVoice::OscType::Noise;
                t->synthPreset = "custom";
            }
            else if (param == "attack" || param == "synthAttack")   { t->attack = val; t->synthPreset = "custom"; }
            else if (param == "decay" || param == "synthDecay")     { t->decay = val; t->synthPreset = "custom"; }
            else if (param == "sustain" || param == "synthSustain") { t->sustain = val; t->synthPreset = "custom"; }
            else if (param == "release" || param == "synthRelease") { t->release = val; t->synthPreset = "custom"; }
            break;
        }
    }
}

void AudioEngine::setTrackSynthPreset(const juce::String& trackId, const juce::String& presetName)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            t->synthPreset = presetName;
            if (presetName == "piano") {
                t->oscType = SynthVoice::OscType::Triangle;
                t->attack = 0.004f; t->decay = 0.28f; t->sustain = 0.16f; t->release = 0.36f;
                t->decayCurve.setExponential(-4.2f);
                t->releaseCurve.setExponential(-5.0f);
            } else if (presetName == "electricPiano") {
                t->oscType = SynthVoice::OscType::Sine;
                t->attack = 0.01f; t->decay = 0.32f; t->sustain = 0.22f; t->release = 0.45f;
                t->decayCurve.setExponential(-3.5f);
                t->releaseCurve.setExponential(-4.0f);
            } else if (presetName == "marimba") {
                t->oscType = SynthVoice::OscType::Sine;
                t->attack = 0.003f; t->decay = 0.28f; t->sustain = 0.05f; t->release = 0.22f;
                t->decayCurve.setExponential(-5.0f);
                t->releaseCurve.setExponential(-6.0f);
            } else if (presetName == "bright") {
                t->oscType = SynthVoice::OscType::Saw;
                t->attack = 0.01f; t->decay = 0.08f; t->sustain = 0.42f; t->release = 0.18f;
                t->decayCurve.setExponential(-3.0f);
            } else if (presetName == "pluck") {
                t->oscType = SynthVoice::OscType::Square;
                t->attack = 0.002f; t->decay = 0.16f; t->sustain = 0.12f; t->release = 0.12f;
                t->decayCurve.setExponential(-6.0f);
                t->releaseCurve.setExponential(-6.0f);
            } else if (presetName == "pad") {
                t->oscType = SynthVoice::OscType::Sine;
                t->attack = 0.18f; t->decay = 0.25f; t->sustain = 0.70f; t->release = 0.90f;
                t->decayCurve.setSCurve();
            } else if (presetName == "bass") {
                t->oscType = SynthVoice::OscType::Square;
                t->attack = 0.01f; t->decay = 0.16f; t->sustain = 0.55f; t->release = 0.18f;
                t->decayCurve.setExponential(-4.0f);
            } else if (presetName == "bell") {
                t->oscType = SynthVoice::OscType::Sine;
                t->attack = 0.002f; t->decay = 0.70f; t->sustain = 0.05f; t->release = 1.20f;
                t->decayCurve.setExponential(-3.2f);
            } else if (presetName == "glass") {
                t->oscType = SynthVoice::OscType::Triangle;
                t->attack = 0.004f; t->decay = 0.45f; t->sustain = 0.24f; t->release = 0.55f;
                t->decayCurve.setExponential(-3.8f);
            } else {
                t->oscType = SynthVoice::OscType::Triangle;
                t->attack = 0.02f; t->decay = 0.12f; t->sustain = 0.48f; t->release = 0.35f;
                t->decayCurve.setExponential(-3.0f);
            }
            break;
        }
    }
}

void AudioEngine::setTrackDecayCurveLut(const juce::String& trackId, const float* data, int count)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->decayCurve.setCustomLut(data, count); break; }
    }
}

void AudioEngine::setTrackDecayTension(const juce::String& trackId, float tension)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->decayCurve.setTension(tension); break; }
    }
}

void AudioEngine::setTrackDecayCurveType(const juce::String& trackId, const juce::String& type, float tension)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            if (type == "linear") t->decayCurve.setLinear();
            else if (type == "exponential") t->decayCurve.setExponential(tension != 0.0f ? tension * -8.0f : -4.0f);
            else if (type == "logarithmic") t->decayCurve.setLogarithmic();
            else if (type == "scurve") t->decayCurve.setSCurve();
            else t->decayCurve.setTension(tension);
            break;
        }
    }
}

void AudioEngine::setDrumPadDecayCurveLut(const juce::String& trackId, int pad, const float* data, int count)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->drumEngine.setPadCurveLut(pad, data, count); break; }
    }
}

void AudioEngine::setDrumPadTension(const juce::String& trackId, int pad, float tension)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId) { t->drumEngine.setPadTension(pad, tension); break; }
    }
}

void AudioEngine::setTrackFxParam(const juce::String& trackId, const juce::String& fxType, const juce::String& param, float val)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            if (fxType == "filter")
            {
                if (param == "cutoff") t->filter.setCutoff(val);
                else if (param == "resonance") t->filter.setResonance(val);
            }
            else if (fxType == "distortion")
            {
                if (param == "drive" || param == "amount") t->distortion.setDrive(val);
                else if (param == "mix" || param == "wet")  t->distortion.setMix(val);
            }
            else if (fxType == "bitcrusher" || fxType == "custom-bitcrusher")
            {
                if (param == "drive") t->bitcrush.setDrive(val);
                else if (param == "bits") t->bitcrush.setBits(val);
                else if (param == "dive") t->bitcrush.setDive(val);
                else if (param == "mix")  t->bitcrush.setMix(val);
            }
            else if (fxType == "delay")
            {
                if (param == "time") t->delay.setTime(val);
                else if (param == "feedback") t->delay.setFeedback(val);
                else if (param == "wet") t->delay.setWet(val);
            }
            else if (fxType == "dpreverb")
            {
                if (param == "wet") t->dpreverb.setWet(val);
                else if (param == "tail" || param == "roomSize") t->dpreverb.setRoomSize(val);
                else if (param == "decay") t->dpreverb.setRoomSize(val);
                else if (param == "tone") t->dpreverb.setDamping(val);
            }
            else if (fxType == "reverb")
            {
                if (param == "roomSize") t->reverb.setRoomSize(val);
                else if (param == "damping") t->reverb.setDamping(val);
                else if (param == "wet") t->reverb.setWet(val);
            }
            else if (fxType == "freeverb")
            {
                if (param == "wet") t->freeverb.setWet(val);
                else if (param == "roomSize") t->freeverb.setRoomSize(val);
                else if (param == "dampening" || param == "damping") t->freeverb.setDamping(val > 1.0f ? val / 10000.0f : val);
            }
            else if (fxType == "chorus")
            {
                if (param == "wet") t->chorus.setWet(val);
                else if (param == "frequency" || param == "rate") t->chorus.setRate(val);
                else if (param == "depth") t->chorus.setDepth(val);
                else if (param == "delayTime") t->chorus.setDelayTime(val);
            }
            else if (fxType == "phaser")
            {
                if (param == "wet") t->phaser.setWet(val);
                else if (param == "frequency" || param == "rate") t->phaser.setRate(val);
                else if (param == "baseFreq") t->phaser.setBaseFrequency(val);
            }
            else if (fxType == "eq")
            {
                if (param == "lowGain") t->eq.setLowGainDb(val);
                else if (param == "midGain") t->eq.setMidGainDb(val);
                else if (param == "highGain") t->eq.setHighGainDb(val);
            }
            break;
        }
    }
}

bool AudioEngine::ensureNoteFxChain(const juce::String& trackId, int chainId,
                                    const juce::String& signature, const juce::var& effects)
{
    auto* effectsArray = effects.getArray();
    if (chainId == 0 || effectsArray == nullptr || effectsArray->isEmpty())
        return false;

    // Fast path: the chain is already built and its settings did not change.
    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id != trackId) continue;
            auto it = t->noteFxChains.find(chainId);
            if (it != t->noteFxChains.end() && it->second->signature == signature)
                return true;
            break;
        }
    }

    // Keep already-loaded VST3 instances and their editor windows across parameter edits.
    std::map<juce::String, std::vector<std::unique_ptr<TrackState::NoteFxStep>>> reusableVst3;
    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id != trackId) continue;
            auto it = t->noteFxChains.find(chainId);
            if (it != t->noteFxChains.end())
            {
                for (auto& oldStep : it->second->steps)
                {
                    if (oldStep->vst3 != nullptr)
                        reusableVst3[oldStep->pluginIdentifier].push_back(std::move(oldStep));
                }
                it->second->steps.clear();
            }
            break;
        }
    }

    // Building VST3 plugins can be slow, so do it outside the track lock.
    auto chain = std::make_unique<TrackState::NoteFxChain>();
    chain->signature = signature;

    for (const auto& ev : *effectsArray)
    {
        auto* obj = ev.getDynamicObject();
        if (obj == nullptr) continue;

        auto step = std::make_unique<TrackState::NoteFxStep>();
        step->type = obj->getProperty("type").toString().toLowerCase();
        if (obj->hasProperty("bypassed"))
        {
            const auto b = obj->getProperty("bypassed");
            step->bypassed = b.isBool() ? (bool)b : (float)b > 0.5f;
        }
        if (obj->hasProperty("wet"))
            step->wet = juce::jlimit(0.0f, 1.0f, (float)obj->getProperty("wet"));

        auto* params = obj->getProperty("params").getDynamicObject();
        auto param = [params](const char* name, float fallback) -> float
        {
            if (params == nullptr || !params->hasProperty(name)) return fallback;
            return (float)params->getProperty(name);
        };

        const auto type = step->type;
        if (type == "vst3")
        {
            const auto pluginId = obj->getProperty("pluginId").toString();
            if (pluginId.isEmpty()) continue;
            auto reuse = reusableVst3.find(pluginId);
            if (reuse != reusableVst3.end() && !reuse->second.empty())
            {
                auto old = std::move(reuse->second.front());
                reuse->second.erase(reuse->second.begin());
                step->vst3 = std::move(old->vst3);
                step->editorWindow = std::move(old->editorWindow);
                step->pluginName = old->pluginName;
                step->pluginIdentifier = pluginId;
            }
            else
            {
                juce::String errorMsg;
                auto plugin = vst3Host.instantiatePlugin(pluginId, currentSampleRate, currentBlockSize, errorMsg);
                if (plugin == nullptr)
                {
                    juce::Logger::writeToLog("[AudioEngine] Note FX VST3 failed (" + pluginId + "): " + errorMsg);
                    continue;
                }
                try
                {
                    plugin->enableAllBuses();
                    plugin->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                    plugin->prepareToPlay(currentSampleRate, currentBlockSize);
                }
                catch (...) {}
                step->pluginName = plugin->getName();
                step->pluginIdentifier = pluginId;
                step->vst3 = std::move(plugin);
            }
        }
        else if (type == "custom" || type == "script" || type == "customjs")
        {
            // Custom JS FX only exist in the browser engine.
            continue;
        }
        else
        {
            configureBuiltinFx(*step, type, param, currentSampleRate, currentBlockSize, false);
            const bool built = step->eq || step->filter || step->distortion || step->bitcrush
                            || step->chorus || step->phaser || step->delay || step->dpreverb
                            || step->reverb || step->freeverb;
            if (!built) continue;
        }

        chain->steps.push_back(std::move(step));
    }

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        auto it = t->noteFxChains.find(chainId);
        if (it != t->noteFxChains.end() && it->second->signature == signature)
            return true;
        t->noteFxChains[chainId] = std::move(chain);
        return true;
    }
    return false;
}

bool AudioEngine::setTrackFxChain(const juce::String& trackId, const juce::String& signature,
                                  const juce::var& effects)
{
    auto* effectsArray = effects.getArray();
    if (effectsArray == nullptr) return false;

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        if (t->fxRackActive && t->fxRackSignature == signature)
            return true;

        // Keep already-loaded VST3 plugins so reordering or slider moves never reload them.
        std::map<juce::String, std::unique_ptr<TrackState::NoteFxStep>> reusable;
        for (auto& step : t->fxRack)
        {
            if (step->vst3 != nullptr && step->fxId.isNotEmpty())
            {
                reusable[step->fxId] = std::move(step);
            }
        }
        t->fxRack.clear();

        std::vector<std::unique_ptr<TrackState::NoteFxStep>> rack;
        rack.reserve((size_t)effectsArray->size());

        for (const auto& ev : *effectsArray)
        {
            auto* obj = ev.getDynamicObject();
            if (obj == nullptr) continue;

            auto step = std::make_unique<TrackState::NoteFxStep>();
            step->type = obj->getProperty("type").toString().toLowerCase();
            step->fxId = obj->getProperty("instanceId").toString();
            if (step->fxId.isEmpty())
                step->fxId = obj->getProperty("fxId").toString();
            if (obj->hasProperty("bypassed"))
            {
                const auto b = obj->getProperty("bypassed");
                step->bypassed = b.isBool() ? (bool)b : (float)b > 0.5f;
            }
            if (obj->hasProperty("wet"))
                step->wet = juce::jlimit(0.0f, 1.0f, (float)obj->getProperty("wet"));

            auto* params = obj->getProperty("params").getDynamicObject();
            auto param = [params](const char* name, float fallback) -> float
            {
                if (params == nullptr || !params->hasProperty(name)) return fallback;
                return (float)params->getProperty(name);
            };

            if (step->type == "vst3")
            {
                const auto pluginId = obj->getProperty("pluginId").toString();
                if (pluginId.isEmpty()) continue;

                auto old = reusable.find(step->fxId);
                if (old != reusable.end() && old->second->pluginIdentifier == pluginId
                    && old->second->vst3 != nullptr)
                {
                    step->vst3 = std::move(old->second->vst3);
                    step->editorWindow = std::move(old->second->editorWindow);
                    step->pluginName = old->second->pluginName;
                    step->pluginIdentifier = pluginId;
                }
                else
                {
                    juce::String errorMsg;
                    auto plugin = vst3Host.instantiatePlugin(pluginId, currentSampleRate, currentBlockSize, errorMsg);
                    if (plugin == nullptr)
                    {
                        juce::Logger::writeToLog("[AudioEngine] Track FX VST3 failed (" + pluginId + "): " + errorMsg);
                        continue;
                    }
                    try
                    {
                        plugin->enableAllBuses();
                        plugin->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                        plugin->prepareToPlay(currentSampleRate, currentBlockSize);
                    }
                    catch (...) {}
                    step->pluginName = plugin->getName();
                    step->pluginIdentifier = pluginId;
                    step->vst3 = std::move(plugin);
                }
            }
            else if (step->type == "custom" || step->type == "script" || step->type == "customjs")
            {
                // Arbitrary JS cannot run inside JUCE; the browser path still renders it.
                continue;
            }
            else
            {
                configureBuiltinFx(*step, step->type, param, currentSampleRate, currentBlockSize, true);
                const bool built = step->eq || step->filter || step->distortion || step->bitcrush
                                || step->chorus || step->phaser || step->delay || step->dpreverb
                                || step->reverb || step->freeverb;
                if (!built) continue;
            }

            rack.push_back(std::move(step));
        }

        t->fxRack = std::move(rack);
        t->fxRackSignature = signature;
        t->fxRackActive = true;
        return true;
    }
    return false;
}

void AudioEngine::pruneNoteFxChains(const juce::String& trackId, const juce::var& activeChainIds)
{
    std::set<int> active;
    if (auto* arr = activeChainIds.getArray())
        for (const auto& id : *arr)
            active.insert((int)id);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        for (auto it = t->noteFxChains.begin(); it != t->noteFxChains.end();)
        {
            if (active.count(it->first) == 0)
            {
                for (auto& step : it->second->steps)
                    step->editorWindow.reset();
                it = t->noteFxChains.erase(it);
            }
            else
            {
                ++it;
            }
        }

        // Chain-tagged VST3 instrument slots are only reachable through their chain.
        for (auto it = t->noteVst3Slots.begin(); it != t->noteVst3Slots.end();)
        {
            if ((*it)->fxChainId != 0 && active.count((*it)->fxChainId) == 0)
            {
                (*it)->editorWindow.reset();
                it = t->noteVst3Slots.erase(it);
            }
            else
            {
                ++it;
            }
        }
        break;
    }
}

bool AudioEngine::openNoteFxVst3Editor(const juce::String& trackId, int chainId, int stepIndex)
{
    juce::MessageManager::callAsync([this, trackId, chainId, stepIndex]() {
        juce::AudioPluginInstance* instPtr = nullptr;
        juce::String title;
        TrackState::NoteFxStep* stepPtr = nullptr;
        {
            std::lock_guard<std::recursive_mutex> lock(trackMutex);
            for (auto& t : tracks)
            {
                if (t->id != trackId) continue;
                auto chainIt = t->noteFxChains.find(chainId);
                if (chainIt == t->noteFxChains.end()) return;
                auto& steps = chainIt->second->steps;
                if (stepIndex < 0 || stepIndex >= (int)steps.size()) return;
                stepPtr = steps[(size_t)stepIndex].get();
                if (stepPtr == nullptr || stepPtr->vst3 == nullptr) return;
                if (stepPtr->editorWindow != nullptr)
                {
                    stepPtr->editorWindow->setVisible(true);
                    stepPtr->editorWindow->toFront(true);
                    return;
                }
                instPtr = stepPtr->vst3.get();
                title = stepPtr->pluginName.isNotEmpty() ? stepPtr->pluginName : "Note FX VST3";
                break;
            }
        }

        if (instPtr == nullptr) return;

        auto newWin = std::make_unique<Vst3PluginWindow>(
            instPtr,
            title,
            [this, trackId, chainId, instPtr]() {
                juce::MessageManager::callAsync([this, trackId, chainId, instPtr]() {
                    std::lock_guard<std::recursive_mutex> lock(trackMutex);
                    for (auto& trk : tracks)
                    {
                        if (trk->id != trackId) continue;
                        auto chainIt = trk->noteFxChains.find(chainId);
                        if (chainIt == trk->noteFxChains.end()) return;
                        for (auto& step : chainIt->second->steps)
                        {
                            if (step->vst3.get() == instPtr)
                            {
                                step->editorWindow.reset();
                                return;
                            }
                        }
                        return;
                    }
                });
            }
        );

        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& trk : tracks)
        {
            if (trk->id != trackId) continue;
            auto chainIt = trk->noteFxChains.find(chainId);
            if (chainIt == trk->noteFxChains.end()) return;
            for (auto& step : chainIt->second->steps)
            {
                if (step->vst3.get() == instPtr)
                {
                    step->editorWindow = std::move(newWin);
                    return;
                }
            }
            return;
        }
    });
    return true;
}

void AudioEngine::setTrackDrumKit(const juce::String& trackId, const juce::String& kitName)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            t->drumEngine.setKitByName(kitName);
            break;
        }
    }
}

void AudioEngine::setTrackSampler(const juce::String& trackId, bool enabled, const SampleEngine::Config& config, const juce::String& base64Data)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);

    TrackState* targetTrack = nullptr;
    for (auto& t : tracks)
    {
        if (t->id == trackId) { targetTrack = t.get(); break; }
    }
    if (targetTrack == nullptr)
    {
        addTrack(trackId, "synth");
        for (auto& t : tracks)
        {
            if (t->id == trackId) { targetTrack = t.get(); break; }
        }
        if (targetTrack == nullptr) return;
    }

    if (!enabled)
    {
        if (targetTrack->samplerEnabled)
        {
            targetTrack->sampleEngine.allNotesOff();
            targetTrack->samplerEnabled = false;
        }
        return;
    }

    targetTrack->samplerEnabled = true;
    targetTrack->sampleEngine.prepare(currentSampleRate);
    targetTrack->sampleEngine.setConfig(config, base64Data);
}

// ---------------------------------------------------------------------------
// VST3 pitch-bend glides
// ---------------------------------------------------------------------------

static float samplePitchCurve(const std::array<float, musegrid::NoteExpression::kCurvePoints>& curve,
                              int size, float t)
{
    t = juce::jlimit(0.0f, 1.0f, t);
    if (size <= 1) return t;

    const float pos = t * (float)(size - 1);
    const int i0 = juce::jlimit(0, size - 1, (int)pos);
    const int i1 = juce::jmin(i0 + 1, size - 1);
    const float frac = pos - (float)i0;
    return curve[(size_t)i0] * (1.0f - frac) + curve[(size_t)i1] * frac;
}

/**
 * Applies queued host-automation writes to the track's VST3 instrument. Runs on the audio
 * thread so plugin parameters are only touched from the thread that processes them.
 */
static void applyPendingVst3Parameters(TrackState& track, int numSamples)
{
    if (track.vst3Instrument == nullptr)
    {
        track.pendingVst3Params.clear();
        track.vst3ParamRamps.clear();
        return;
    }

    auto& params = track.vst3Instrument->getParameters();

    for (const auto& target : track.pendingVst3Params)
    {
        if (target.index < 0 || target.index >= params.size()) continue;
        auto* param = params[target.index];
        if (param == nullptr) continue;

        const float value = juce::jlimit(0.0f, 1.0f, target.value);
        for (auto it = track.vst3ParamRamps.begin(); it != track.vst3ParamRamps.end();)
        {
            if (it->index == target.index) it = track.vst3ParamRamps.erase(it);
            else ++it;
        }

        if (target.rampSamples > 0)
            track.vst3ParamRamps.push_back({ target.index, param->getValue(), value, target.rampSamples, 0 });
        else
            param->setValueNotifyingHost(value);
    }
    track.pendingVst3Params.clear();

    for (auto it = track.vst3ParamRamps.begin(); it != track.vst3ParamRamps.end();)
    {
        it->elapsedSamples += numSamples;
        const float progress = juce::jlimit(0.0f, 1.0f,
            (float)it->elapsedSamples / (float)juce::jmax(1, it->totalSamples));
        if (it->index >= 0 && it->index < params.size())
            if (auto* param = params[it->index])
                param->setValueNotifyingHost(it->startValue + (it->targetValue - it->startValue) * progress);

        if (progress >= 1.0f) it = track.vst3ParamRamps.erase(it);
        else ++it;
    }
}

/**
 * Widens a plugin's own pitch-bend range when it exposes one as a parameter. Most VST3
 * instruments ignore the RPN fallback, so this is what makes large glides audible.
 */
static void widenPluginPitchBend(juce::AudioPluginInstance* plugin, int semitones)
{
    if (plugin == nullptr) return;

    for (auto* param : plugin->getParameters())
    {
        if (param == nullptr) continue;
        const auto name = param->getName(96).toLowerCase();
        const bool isBendRange = name.contains("pitch") && name.contains("bend")
            && (name.contains("range") || name.contains("amount") || name.contains("sensitivity"));
        if (!isBendRange) continue;

        auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(param);
        if (ranged == nullptr) continue;

        const auto& range = ranged->getNormalisableRange();
        const float target = juce::jlimit(range.start, range.end, (float)semitones);
        if (target > ranged->getValue())
            ranged->setValueNotifyingHost(ranged->convertTo0to1(target));
        return;
    }
}

/**
 * Reserves a MIDI channel for the gliding note, queues a pitch-bend-sensitivity RPN and
 * registers the ramp. Returns the channel the note-on must use.
 */
static int startVst3Glide(std::vector<PitchGlide>& glides,
                          juce::MidiBuffer& midi,
                          const musegrid::NoteExpression& expression,
                          int& nextChannel,
                          juce::AudioPluginInstance* plugin,
                          int midiPitch,
                          float startPitch,
                          float endPitch,
                          float slideSeconds,
                          float durationSeconds,
                          double sampleRate,
                          float pitchOffsetSemitones = 0.0f,
                          bool forceReserve = false)
{
    // The note-on is an integer MIDI pitch, so any fractional / transposed pitch is carried
    // by bend even when the note does not glide. This is what makes VST3 microtonal.
    const float baseSemis = (startPitch + pitchOffsetSemitones) - (float)midiPitch;
    const bool hasGlide = endPitch >= 0.0f && std::abs(endPitch - startPitch) >= 0.001f;
    // Per-note pan also needs a private channel: CC10 is channel-wide, so it must not leak
    // onto the shared channel-1 notes.
    const bool hasPan = std::abs(expression.pan) > 0.001f;
    // Per-note volume is CC7 as well, so it also needs a channel of its own.
    const bool hasGain = std::abs(expression.gain - 1.0f) > 0.001f;
    if (!forceReserve && !hasPan && !hasGain && !hasGlide && std::abs(baseSemis) < 0.0005f) return 1;
    if (sampleRate <= 0.0) return 1;

    float totalSeconds = slideSeconds > 0.0f ? slideSeconds : durationSeconds;
    if (hasGlide && totalSeconds <= 0.0f) totalSeconds = 1.0f;
    if (!hasGlide) totalSeconds = 0.0f;

    const int channel = juce::jlimit(2, 16, nextChannel);
    nextChannel = channel >= 16 ? 2 : channel + 1;

    PitchGlide glide;
    glide.channel = channel;
    glide.midiPitch = midiPitch;
    glide.baseSemitones = baseSemis;
    glide.semitoneDelta = hasGlide ? (endPitch - startPitch) : 0.0f;
    glide.stepped = expression.steppedGlide;
    glide.curveSize = juce::jlimit(0, musegrid::NoteExpression::kCurvePoints, expression.slideCurveSize);
    for (int i = 0; i < glide.curveSize; ++i)
        glide.curve[(size_t)i] = expression.slideCurve[(size_t)i];

    const int bendRange = juce::jlimit(2, 96, (int)std::ceil(std::abs(baseSemis) + std::abs(glide.semitoneDelta)) + 1);
    glide.bendRangeSemitones = bendRange;
    glide.totalSamples = juce::jmax(1.0f, totalSeconds * (float)sampleRate);

    // RPN 0 = pitch-bend sensitivity, in semitones. Plugins that ignore RPN still get the
    // bend stream, clamped to their own fixed range.
    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 101, 0), 0);
    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 100, 0), 0);
    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 6, bendRange), 0);
    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 38, 0), 0);
    midi.addEvent(juce::MidiMessage::pitchWheel(channel, 8192), 0);
    // A channel that hosted a morph fade may still be at CC7 0; start every glide note at its
    // own level so per-note volume automation survives a recycled channel.
    const int levelValue = juce::jlimit(0, 127,
        (int)std::lround(juce::jlimit(0.0f, 1.0f, expression.gain) * 127.0f));
    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 7, levelValue), 0);
    // Reset pan first so a recycled channel never inherits the previous note's position.
    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 10, 64), 0);
    if (hasPan)
    {
        const int panValue = juce::jlimit(0, 127,
            (int)std::lround((juce::jlimit(-1.0f, 1.0f, expression.pan) * 0.5f + 0.5f) * 127.0f));
        midi.addEvent(juce::MidiMessage::controllerEvent(channel, 10, panValue), 0);
    }

    widenPluginPitchBend(plugin, bendRange);
    glides.push_back(glide);
    return channel;
}

/** Morph crossfade for VST3 instruments, streamed as CC7 volume on the note's channel. */
static void startVst3VolumeFade(std::vector<Vst3VolumeFade>& fades,
                                juce::MidiBuffer& midi,
                                int channel,
                                int midiPitch,
                                float fadeInSeconds,
                                float fadeOutSeconds,
                                double sampleRate,
                                float level = 1.0f)
{
    if (sampleRate <= 0.0) return;
    const bool fadingIn = fadeInSeconds > 0.0001f;
    const bool fadingOut = fadeOutSeconds > 0.0001f;
    if (!fadingIn && !fadingOut) return;

    // A fade-in climbs to the note's own automation level, a fade-out falls from it.
    level = juce::jlimit(0.0f, 1.0f, level);

    Vst3VolumeFade fade;
    fade.channel = channel;
    fade.midiPitch = midiPitch;
    fade.level = level;
    fade.startValue = fadingIn ? 0.0f : level;
    fade.endValue = fadingIn ? level : 0.0f;
    const float seconds = fadingIn ? fadeInSeconds : fadeOutSeconds;
    fade.totalSamples = juce::jmax(1.0f, seconds * (float)sampleRate);

    midi.addEvent(juce::MidiMessage::controllerEvent(channel, 7, (int)std::lround(fade.startValue * 127.0f)), 0);
    fades.push_back(fade);
}

static void renderVst3VolumeFades(std::vector<Vst3VolumeFade>& fades, juce::MidiBuffer& midi, int numSamples)
{
    for (auto it = fades.begin(); it != fades.end(); )
    {
        const bool endsInBlock = (it->totalSamples - it->elapsedSamples) <= (float)numSamples;
        const float t = endsInBlock ? 1.0f
                                    : juce::jlimit(0.0f, 1.0f, (it->elapsedSamples + (float)(numSamples - 1)) / it->totalSamples);
        const int value = juce::jlimit(0, 127, (int)std::lround((it->startValue + (it->endValue - it->startValue) * t) * 127.0f));
        if (value != it->lastValue)
        {
            midi.addEvent(juce::MidiMessage::controllerEvent(it->channel, 7, value), juce::jmax(0, numSamples - 1));
            it->lastValue = value;
        }

        it->elapsedSamples += (float)numSamples;
        if (endsInBlock)
            it = fades.erase(it);
        else
            ++it;
    }
}

static void renderVst3Glides(std::vector<PitchGlide>& glides, juce::MidiBuffer& midi, int numSamples)
{
    for (auto it = glides.begin(); it != glides.end(); )
    {
        // The bend for the end of this block, or the exact landing point when the glide
        // finishes inside it. Erasing without emitting t = 1 would leave the note a few
        // cents flat, which is audible on short slides.
        const float remaining = it->totalSamples - it->elapsedSamples;
        const bool landsInBlock = remaining <= (float)numSamples;
        const int offset = landsInBlock ? juce::jlimit(0, juce::jmax(0, numSamples - 1), (int)std::ceil(remaining))
                                        : juce::jmax(0, numSamples - 1);
        const float t = landsInBlock ? 1.0f
                                     : (it->totalSamples > 0.0f ? juce::jlimit(0.0f, 1.0f, (it->elapsedSamples + (float)offset) / it->totalSamples) : 1.0f);
        float semitones = it->baseSemitones + it->semitoneDelta * samplePitchCurve(it->curve, it->curveSize, t);
        if (it->stepped) semitones = std::round(semitones);

        const float normalised = semitones / (float)it->bendRangeSemitones;
        const int bend = juce::jlimit(0, 16383, 8192 + (int)std::lround(normalised * 8191.0f));
        if (bend != it->lastBend)
        {
            midi.addEvent(juce::MidiMessage::pitchWheel(it->channel, bend), offset);
            it->lastBend = bend;
        }

        it->elapsedSamples += (float)numSamples;
        if (landsInBlock)
            it = glides.erase(it);
        else
            ++it;
    }
}

static void clearPitchGlides(std::vector<PitchGlide>& glides, juce::MidiBuffer& midi, int midiPitch)
{
    for (auto it = glides.begin(); it != glides.end(); )
    {
        if (midiPitch < 0 || it->midiPitch == midiPitch)
        {
            midi.addEvent(juce::MidiMessage::pitchWheel(it->channel, 8192), 0);
            it = glides.erase(it);
        }
        else
        {
            ++it;
        }
    }
}

/** Drops CC7 morph fades for a finished note. Without this a note that dies mid
    fade-out would leave the shared channel at CC7 0 and silence every later note. */
static void clearVst3VolumeFades(std::vector<Vst3VolumeFade>& fades,
                                 juce::MidiBuffer& midi,
                                 int channel,
                                 int midiPitch,
                                 int offset = 0)
{
    for (auto it = fades.begin(); it != fades.end(); )
    {
        if (it->channel == channel && (midiPitch < 0 || it->midiPitch == midiPitch))
        {
            midi.addEvent(juce::MidiMessage::controllerEvent(it->channel, 7, 127), juce::jmax(0, offset));
            it = fades.erase(it);
        }
        else
        {
            ++it;
        }
    }
}

/** Restores CC7 on every channel before wiping all morph fades. */
static void resetVst3VolumeFades(std::vector<Vst3VolumeFade>& fades, juce::MidiBuffer& midi)
{
    for (int ch = 1; ch <= 16; ++ch)
        midi.addEvent(juce::MidiMessage::controllerEvent(ch, 7, 127), 0);
    fades.clear();
}

void AudioEngine::playNote(const juce::String& trackId,
                          float pitchMidi,
                          float velocity,
                          float durationSeconds,
                          const juce::String& instrument,
                          float targetPitchMidi,
                          float slideTimeSeconds,
                          float vibratoDepthCents,
                          float vibratoRateHz,
                          float tremoloDepth,
                          float tremoloRateHz,
                          float filterStartHz,
                          float filterEndHz,
                          float filterSweepTimeSeconds,
                          const juce::String& lyric,
                          float pitchOffsetSemitones,
                          float drumDecay,
                          float slideSemitones,
                          float punchOctaves,
                          float resonanceHz,
                          const musegrid::NoteExpression& expression)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    const int noteId = (int)(pitchMidi * 100.0f + 0.5f);

    TrackState* targetTrack = nullptr;
    for (auto& t : tracks)
    {
        if (t->id == trackId) { targetTrack = t.get(); break; }
    }

    if (!targetTrack)
    {
        auto newTrack = std::make_unique<TrackState>();
        newTrack->id = trackId;
        newTrack->instrument = instrument.isNotEmpty() ? instrument : "synth";
        newTrack->eq.prepare(currentSampleRate, currentBlockSize);
        newTrack->filter.prepare(currentSampleRate, currentBlockSize);
        newTrack->distortion.prepare(currentSampleRate, currentBlockSize);
        newTrack->bitcrush.prepare(currentSampleRate, currentBlockSize);
        newTrack->chorus.prepare(currentSampleRate, currentBlockSize);
        newTrack->phaser.prepare(currentSampleRate, currentBlockSize);
        newTrack->delay.prepare(currentSampleRate, currentBlockSize);
        newTrack->dpreverb.prepare(currentSampleRate, currentBlockSize);
        newTrack->reverb.prepare(currentSampleRate, currentBlockSize);
        newTrack->freeverb.prepare(currentSampleRate, currentBlockSize);
        newTrack->drumEngine.prepare(currentSampleRate);
        newTrack->sampleEngine.prepare(currentSampleRate);
        targetTrack = newTrack.get();
        tracks.push_back(std::move(newTrack));
    }

    if (instrument.isNotEmpty())
    {
        targetTrack->instrument = instrument;
    }

    juce::String inst = targetTrack->instrument.isNotEmpty() ? targetTrack->instrument : "synth";

    // A drum hit takes the same note-level fields a synth voice gets: the note length gates how
    // long the pad rings, and the vibrato/filter fields are the hit's own modulation.
    DrumEngine::HitModulation drumModulation;
    drumModulation.holdSeconds = durationSeconds;
    drumModulation.vibratoDepthCents = vibratoDepthCents;
    drumModulation.vibratoRateHz = vibratoRateHz;
    drumModulation.filterStartHz = filterStartHz;
    drumModulation.filterEndHz = filterEndHz;
    drumModulation.filterSweepSeconds = filterSweepTimeSeconds;

    // Per-note sound override takes precedence over the track instrument.
    if (expression.overrideKind.isNotEmpty() && expression.overrideValue.isNotEmpty())
    {
        if (expression.overrideKind == "vst3")
        {
            TrackState::NoteVst3Slot* slot = nullptr;
            for (auto& s : targetTrack->noteVst3Slots)
            {
                if (s->identifier != expression.overrideValue || s->plugin == nullptr) continue;
                if (expression.instanceKey.isNotEmpty())
                {
                    // One instance per note: the key alone identifies the slot, and the
                    // chain follows the note if its per-note FX rack changes.
                    if (s->instanceKey != expression.instanceKey) continue;
                    s->fxChainId = expression.fxChainId;
                }
                else if (!s->instanceKey.isEmpty() || s->fxChainId != expression.fxChainId)
                {
                    continue;
                }
                slot = s.get();
                break;
            }

            if (slot == nullptr && (expression.instanceKey.isNotEmpty() || expression.fxChainId != 0))
            {
                juce::String errorMsg;
                auto plugin = vst3Host.instantiatePlugin(expression.overrideValue, currentSampleRate,
                                                         currentBlockSize, errorMsg);
                if (plugin != nullptr)
                {
                    try
                    {
                        plugin->enableAllBuses();
                        plugin->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                        plugin->prepareToPlay(currentSampleRate, currentBlockSize);
                    }
                    catch (...) {}
                    auto newSlot = std::make_unique<TrackState::NoteVst3Slot>();
                    newSlot->identifier = expression.overrideValue;
                    newSlot->name = plugin->getName();
                    newSlot->instanceKey = expression.instanceKey;
                    newSlot->fxChainId = expression.fxChainId;
                    newSlot->plugin = std::move(plugin);
                    slot = newSlot.get();
                    targetTrack->noteVst3Slots.push_back(std::move(newSlot));
                }
                else
                {
                    juce::Logger::writeToLog("[AudioEngine] Per-note VST3 slot failed: " + errorMsg);
                }
            }

            if (slot != nullptr)
            {
                std::lock_guard<std::mutex> midiLock(slot->midiMutex);
                int rawPitch = (int)(pitchMidi + 0.5f);
                int midiPitch = rawPitch;
                if (inst == "drum" && rawPitch >= 0 && rawPitch < 16)
                {
                    static const int padToGmMidi[16] = {
                        36, 38, 42, 46, 39, 45, 47, 50, 49, 51, 56, 54, 64, 63, 75, 37
                    };
                    midiPitch = padToGmMidi[rawPitch];
                }
                midiPitch = juce::jlimit(0, 127, midiPitch);
                int midiVel = juce::jlimit(1, 127, (int)(velocity * 127.0f));
                const int channel = startVst3Glide(slot->pitchGlides, slot->pendingMidi, expression,
                                                   slot->nextGlideChannel, slot->plugin.get(),
                                                   midiPitch, pitchMidi, targetPitchMidi,
                                                   slideTimeSeconds, durationSeconds, currentSampleRate,
                                                   pitchOffsetSemitones,
                                                   expression.morphFadeInSeconds > 0.0f || expression.morphFadeOutSeconds > 0.0f);
                slot->pendingMidi.addEvent(juce::MidiMessage::noteOn(channel, midiPitch, (juce::uint8)midiVel), 0);
                startVst3VolumeFade(slot->volumeFades, slot->pendingMidi, channel, midiPitch,
                                    expression.morphFadeInSeconds, expression.morphFadeOutSeconds, currentSampleRate,
                                    expression.gain);
                if (durationSeconds > 0.0f)
                {
                    int samples = std::max(1, (int)(durationSeconds * currentSampleRate));
                    slot->scheduledNoteOffs.push_back({ midiPitch, samples, channel });
                }
            }
            else
            {
                juce::Logger::writeToLog("[AudioEngine] Per-note VST3 slot not loaded: " + expression.overrideValue);
            }
            return;
        }

        if (expression.overrideKind == "kit")
        {
            targetTrack->drumEngine.triggerHit((int)pitchMidi, velocity, pitchOffsetSemitones,
                                               drumDecay, slideSemitones, slideTimeSeconds,
                                               punchOctaves, resonanceHz, expression.overrideValue,
                                               expression.fxChainId, expression, drumModulation);
            return;
        }

        if (expression.overrideKind == "preset")
        {
            if (expression.overrideValue == "vocal")
            {
                voiceManager.noteOnVocal(trackId, noteId, pitchMidi, velocity, durationSeconds, lyric,
                                         1.0f, 0.1f, 0.85f, expression.fxChainId,
                                         expression, targetPitchMidi, slideTimeSeconds);
            }
            else if (expression.overrideValue == "physical")
            {
                voiceManager.noteOnPhysical(trackId, noteId, pitchMidi, velocity, durationSeconds,
                                            0.5f, 0.5f, expression.fxChainId,
                                            expression, targetPitchMidi, slideTimeSeconds);
            }
            else
            {
                // -1 oscType / negative ADSR keeps the preset's own envelope instead of the track's.
                voiceManager.noteOnSynth(trackId, noteId, pitchMidi, velocity, durationSeconds,
                                         expression.overrideValue,
                                         (SynthVoice::OscType)-1, -1.0f, -1.0f, 0.0f, 0.0f,
                                         targetPitchMidi, slideTimeSeconds,
                                         vibratoDepthCents, vibratoRateHz,
                                         tremoloDepth, tremoloRateHz,
                                         filterStartHz, filterEndHz, filterSweepTimeSeconds,
                                         nullptr, nullptr,
                                         expression);
            }
            return;
        }
    }

    if (targetTrack->samplerEnabled && targetTrack->vst3Instrument == nullptr)
    {
        targetTrack->sampleEngine.noteOn(noteId, pitchMidi, velocity, durationSeconds, pitchOffsetSemitones,
                                         expression.fxChainId, expression, targetPitchMidi, slideTimeSeconds);
    }
    else if (inst == "vst3" || targetTrack->vst3Instrument != nullptr)
    {
        int rawPitch = (int)(pitchMidi + 0.5f);
        int midiPitch = rawPitch;
        if (inst == "drum" && rawPitch >= 0 && rawPitch < 16)
        {
            static const int padToGmMidi[16] = {
                36, // 0: Kick Drum (C1 / GM 36)
                38, // 1: Snare Drum (D1 / GM 38)
                42, // 2: Closed Hi-Hat (F#1 / GM 42)
                46, // 3: Open Hi-Hat (A#1 / GM 46)
                39, // 4: Hand Clap (D#1 / GM 39)
                45, // 5: Low Tom (A1 / GM 45)
                47, // 6: Mid Tom (B1 / GM 47)
                50, // 7: High Tom (D2 / GM 50)
                49, // 8: Crash Cymbal (C#2 / GM 49)
                51, // 9: Ride Cymbal (D#2 / GM 51)
                56, // 10: Cowbell (G#2 / GM 56)
                54, // 11: Tambourine (F#2 / GM 54)
                64, // 12: Lo-Conga (E3 / GM 64)
                63, // 13: Hi-Conga (D#3 / GM 63)
                75, // 14: Claves (D#4 / GM 75)
                37  // 15: Rimshot (C#1 / GM 37)
            };
            midiPitch = padToGmMidi[rawPitch];
        }
        midiPitch = juce::jlimit(0, 127, midiPitch);
        int midiVel = juce::jlimit(1, 127, (int)(velocity * 127.0f));
        const int samples = durationSeconds > 0.0f
            ? std::max(1, (int)(durationSeconds * currentSampleRate)) : 0;

        // A per-note chain needs an isolated instrument output, so the track's VST3 is
        // cloned (with its current state) into a chain-tagged slot when one exists.
        if (expression.fxChainId != 0 && targetTrack->vst3Instrument != nullptr
            && targetTrack->noteFxChains.count(expression.fxChainId) > 0)
        {
            const auto identifier = targetTrack->vst3InstrumentIdentifier;
            TrackState::NoteVst3Slot* slot = nullptr;
            for (auto& s : targetTrack->noteVst3Slots)
                if (s->identifier == identifier && s->fxChainId == expression.fxChainId
                    && s->instanceKey.isEmpty()
                    && s->plugin != nullptr) { slot = s.get(); break; }

            if (slot == nullptr && identifier.isNotEmpty())
            {
                juce::String errorMsg;
                auto plugin = vst3Host.instantiatePlugin(identifier, currentSampleRate,
                                                         currentBlockSize, errorMsg);
                if (plugin != nullptr)
                {
                    try
                    {
                        plugin->enableAllBuses();
                        plugin->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
                        plugin->prepareToPlay(currentSampleRate, currentBlockSize);
                        juce::MemoryBlock state;
                        targetTrack->vst3Instrument->getStateInformation(state);
                        if (state.getSize() > 0)
                            plugin->setStateInformation(state.getData(), (int)state.getSize());
                    }
                    catch (...) {}
                    auto newSlot = std::make_unique<TrackState::NoteVst3Slot>();
                    newSlot->identifier = identifier;
                    newSlot->name = plugin->getName();
                    newSlot->fxChainId = expression.fxChainId;
                    newSlot->plugin = std::move(plugin);
                    slot = newSlot.get();
                    targetTrack->noteVst3Slots.push_back(std::move(newSlot));
                }
                else
                {
                    juce::Logger::writeToLog("[AudioEngine] Track VST3 clone failed: " + errorMsg);
                }
            }

            if (slot != nullptr)
            {
                std::lock_guard<std::mutex> midiLock(slot->midiMutex);
                const int channel = startVst3Glide(slot->pitchGlides, slot->pendingMidi, expression,
                                                   slot->nextGlideChannel, slot->plugin.get(),
                                                   midiPitch, pitchMidi, targetPitchMidi,
                                                   slideTimeSeconds, durationSeconds, currentSampleRate,
                                                   pitchOffsetSemitones,
                                                   expression.morphFadeInSeconds > 0.0f || expression.morphFadeOutSeconds > 0.0f);
                slot->pendingMidi.addEvent(juce::MidiMessage::noteOn(channel, midiPitch, (juce::uint8)midiVel), 0);
                startVst3VolumeFade(slot->volumeFades, slot->pendingMidi, channel, midiPitch,
                                    expression.morphFadeInSeconds, expression.morphFadeOutSeconds, currentSampleRate,
                                    expression.gain);
                if (samples > 0)
                    slot->scheduledNoteOffs.push_back({ midiPitch, samples, channel });
                return;
            }
        }

        std::lock_guard<std::mutex> midiLock(targetTrack->midiMutex);
        const int channel = startVst3Glide(targetTrack->pitchGlides, targetTrack->pendingMidi, expression,
                                           targetTrack->nextGlideChannel, targetTrack->vst3Instrument.get(),
                                           midiPitch, pitchMidi, targetPitchMidi,
                                           slideTimeSeconds, durationSeconds, currentSampleRate,
                                           pitchOffsetSemitones,
                                           expression.morphFadeInSeconds > 0.0f || expression.morphFadeOutSeconds > 0.0f);
        targetTrack->pendingMidi.addEvent(juce::MidiMessage::noteOn(channel, midiPitch, (juce::uint8)midiVel), 0);
        startVst3VolumeFade(targetTrack->volumeFades, targetTrack->pendingMidi, channel, midiPitch,
                            expression.morphFadeInSeconds, expression.morphFadeOutSeconds, currentSampleRate,
                            expression.gain);
        if (samples > 0)
            targetTrack->scheduledNoteOffs.push_back({ midiPitch, samples, channel });
    }
    else if (inst == "drum")
    {
        targetTrack->drumEngine.triggerHit((int)pitchMidi, velocity, pitchOffsetSemitones, drumDecay, slideSemitones, slideTimeSeconds, punchOctaves, resonanceHz, {}, expression.fxChainId, expression, drumModulation);
    }
    else if (inst == "physical")
    {
        voiceManager.noteOnPhysical(trackId, noteId, pitchMidi, velocity, durationSeconds, 0.5f, 0.5f,
                                    expression.fxChainId, expression, targetPitchMidi, slideTimeSeconds);
    }
    else if (inst == "vocal" || (inst == "synth" && targetTrack->synthPreset == "vocal"))
    {
        voiceManager.noteOnVocal(trackId, noteId, pitchMidi, velocity, durationSeconds, lyric, 1.0f, 0.1f, 0.85f,
                                 expression.fxChainId, expression, targetPitchMidi, slideTimeSeconds);
    }
    else if (inst == "synth" && targetTrack->synthPreset == "physical")
    {
        voiceManager.noteOnPhysical(trackId, noteId, pitchMidi, velocity, durationSeconds, 0.5f, 0.5f,
                                    expression.fxChainId, expression, targetPitchMidi, slideTimeSeconds);
    }
    else // Default "synth"
    {
        voiceManager.noteOnSynth(trackId, noteId, pitchMidi, velocity, durationSeconds,
                                 targetTrack->synthPreset,
                                 targetTrack->oscType, targetTrack->attack, targetTrack->decay, targetTrack->sustain, targetTrack->release,
                                 targetPitchMidi, slideTimeSeconds,
                                 vibratoDepthCents, vibratoRateHz,
                                 tremoloDepth, tremoloRateHz,
                                 filterStartHz, filterEndHz, filterSweepTimeSeconds,
                                 &targetTrack->decayCurve, &targetTrack->releaseCurve,
                                 expression);
    }
}

void AudioEngine::noteOff(const juce::String& trackId, int noteId)
{
    voiceManager.noteOff(trackId, noteId);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            if (t->samplerEnabled)
                t->sampleEngine.noteOff(noteId);

            for (auto& slot : t->noteVst3Slots)
            {
                std::lock_guard<std::mutex> midiLock(slot->midiMutex);
                if (noteId > 0)
                {
                    int rawPitch = (int)(noteId / 100.0f + 0.5f);
                    int midiPitch = rawPitch;
                    if (t->instrument == "drum" && rawPitch >= 0 && rawPitch < 16)
                    {
                        static const int padToGmMidi[16] = {
                            36, 38, 42, 46, 39, 45, 47, 50, 49, 51, 56, 54, 64, 63, 75, 37
                        };
                        midiPitch = padToGmMidi[rawPitch];
                    }
                    midiPitch = juce::jlimit(0, 127, midiPitch);
                    int channel = 1;
                    for (auto& off : slot->scheduledNoteOffs)
                        if (off.midiPitch == midiPitch) { channel = off.midiChannel; break; }
                    slot->pendingMidi.addEvent(juce::MidiMessage::noteOff(channel, midiPitch), 0);
                    clearPitchGlides(slot->pitchGlides, slot->pendingMidi, midiPitch);
                    clearVst3VolumeFades(slot->volumeFades, slot->pendingMidi, channel, midiPitch);
                    for (auto it = slot->scheduledNoteOffs.begin(); it != slot->scheduledNoteOffs.end(); )
                    {
                        if (it->midiPitch == midiPitch) it = slot->scheduledNoteOffs.erase(it);
                        else ++it;
                    }
                }
                else
                {
                    for (int ch = 1; ch <= 16; ++ch)
                        slot->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(ch), 0);
                    clearPitchGlides(slot->pitchGlides, slot->pendingMidi, -1);
                    resetVst3VolumeFades(slot->volumeFades, slot->pendingMidi);
                    slot->scheduledNoteOffs.clear();
                }
            }
            break;
        }
    }

    for (auto& t : tracks)
    {
        if (t->id == trackId && t->vst3Instrument != nullptr)
        {
            std::lock_guard<std::mutex> midiLock(t->midiMutex);
            if (noteId > 0)
            {
                int rawPitch = (int)(noteId / 100.0f + 0.5f);
                int midiPitch = rawPitch;
                if (t->instrument == "drum" && rawPitch >= 0 && rawPitch < 16)
                {
                    static const int padToGmMidi[16] = {
                        36, 38, 42, 46, 39, 45, 47, 50, 49, 51, 56, 54, 64, 63, 75, 37
                    };
                    midiPitch = padToGmMidi[rawPitch];
                }
                midiPitch = juce::jlimit(0, 127, midiPitch);
                int channel = 1;
                for (auto& off : t->scheduledNoteOffs)
                    if (off.midiPitch == midiPitch) { channel = off.midiChannel; break; }
                t->pendingMidi.addEvent(juce::MidiMessage::noteOff(channel, midiPitch), 0);
                clearPitchGlides(t->pitchGlides, t->pendingMidi, midiPitch);
                clearVst3VolumeFades(t->volumeFades, t->pendingMidi, channel, midiPitch);
                for (auto it = t->scheduledNoteOffs.begin(); it != t->scheduledNoteOffs.end(); )
                {
                    if (it->midiPitch == midiPitch)
                        it = t->scheduledNoteOffs.erase(it);
                    else
                        ++it;
                }
            }
            else
            {
                for (int ch = 1; ch <= 16; ++ch)
                    t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(ch), 0);
                clearPitchGlides(t->pitchGlides, t->pendingMidi, -1);
                resetVst3VolumeFades(t->volumeFades, t->pendingMidi);
                t->scheduledNoteOffs.clear();
            }
            break;
        }
    }
}

void AudioEngine::allNotesOff()
{
    voiceManager.allNotesOff();

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->samplerEnabled)
            t->sampleEngine.allNotesOff();

        if (t->vst3Instrument != nullptr)
        {
            std::lock_guard<std::mutex> midiLock(t->midiMutex);
            for (int ch = 1; ch <= 16; ++ch)
            {
                t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(ch), 0);
                t->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(ch), 0);
            }
            clearPitchGlides(t->pitchGlides, t->pendingMidi, -1);
            resetVst3VolumeFades(t->volumeFades, t->pendingMidi);
            t->scheduledNoteOffs.clear();
        }

        for (auto& slot : t->noteVst3Slots)
        {
            std::lock_guard<std::mutex> midiLock(slot->midiMutex);
            for (int ch = 1; ch <= 16; ++ch)
            {
                slot->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(ch), 0);
                slot->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(ch), 0);
            }
            clearPitchGlides(slot->pitchGlides, slot->pendingMidi, -1);
            resetVst3VolumeFades(slot->volumeFades, slot->pendingMidi);
            slot->scheduledNoteOffs.clear();
        }
    }
}

void AudioEngine::killAllNotesOnTrack(const juce::String& trackId)
{
    voiceManager.killAllNotesOnTrack(trackId);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;

        if (t->samplerEnabled)
            t->sampleEngine.allNotesOff();

        t->drumEngine.allNotesOff();

        if (t->vst3Instrument != nullptr)
        {
            std::lock_guard<std::mutex> midiLock(t->midiMutex);
            for (int ch = 1; ch <= 16; ++ch)
            {
                t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(ch), 0);
                t->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(ch), 0);
            }
            clearPitchGlides(t->pitchGlides, t->pendingMidi, -1);
            resetVst3VolumeFades(t->volumeFades, t->pendingMidi);
        }
        t->scheduledNoteOffs.clear();

        for (auto& slot : t->noteVst3Slots)
        {
            std::lock_guard<std::mutex> midiLock(slot->midiMutex);
            for (int ch = 1; ch <= 16; ++ch)
            {
                slot->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(ch), 0);
                slot->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(ch), 0);
            }
            clearPitchGlides(slot->pitchGlides, slot->pendingMidi, -1);
            resetVst3VolumeFades(slot->volumeFades, slot->pendingMidi);
            slot->scheduledNoteOffs.clear();
        }
        break;
    }
}

#if JUCE_WINDOWS
#include <excpt.h>
static inline bool safePluginProcessBlock(juce::AudioPluginInstance* plugin, juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    __try
    {
        plugin->processBlock(buffer, midi);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}
#else
static inline bool safePluginProcessBlock(juce::AudioPluginInstance* plugin, juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    try { plugin->processBlock(buffer, midi); return true; } catch (...) { return false; }
}
#endif

void AudioEngine::audioDeviceIOCallbackWithContext(const float* const* /*inputChannelData*/,
                                                 int /*numInputChannels*/,
                                                 float* const* outputChannelData,
                                                 int numOutputChannels,
                                                 int numSamples,
                                                 const juce::AudioIODeviceCallbackContext& /*context*/)
{
    if (numOutputChannels < 2 || numSamples <= 0) return;

    float* outL = outputChannelData[0];
    float* outR = outputChannelData[1];

    std::fill(outL, outL + numSamples, 0.0f);
    std::fill(outR, outR + numSamples, 0.0f);

    // An offline bounce owns the shared voice/FX/plugin state; the live device must stay silent
    // for its duration instead of racing the renderer for the same objects.
    if (offlineBusy.load(std::memory_order_acquire)) return;

    renderBlock(outputChannelData, numOutputChannels, numSamples);
}

void AudioEngine::renderBlock(float* const* outputChannelData, int numOutputChannels, int numSamples)
{
    if (numOutputChannels < 2 || numSamples <= 0) return;

    float* outL = outputChannelData[0];
    float* outR = outputChannelData[1];

    std::fill(outL, outL + numSamples, 0.0f);
    std::fill(outR, outR + numSamples, 0.0f);

    trackBuffer.setSize(2, numSamples, false, false, true);
    noteFxBuffer.setSize(2, numSamples, false, false, true);
    noteFxMixBuffer.setSize(2, numSamples, false, false, true);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);

    // Check if any track is soloed
    bool hasSolo = false;
    for (const auto& t : tracks)
    {
        if (t->soloed) { hasSolo = true; break; }
    }

    for (auto& t : tracks)
    {
        if (t->muted) continue;
        if (hasSolo && !t->soloed) continue;

        trackBuffer.clear();
        noteFxMixBuffer.clear();
        float* trackL = trackBuffer.getWritePointer(0);
        float* trackR = trackBuffer.getWritePointer(1);

        if (t->vst3Instrument != nullptr)
        {
            juce::MidiBuffer midiForBlock;
            {
                std::lock_guard<std::mutex> midiLock(t->midiMutex);
                midiForBlock.swapWith(t->pendingMidi);

                for (auto it = t->scheduledNoteOffs.begin(); it != t->scheduledNoteOffs.end(); )
                {
                    if (it->sampleCountdown <= numSamples)
                    {
                        int offset = std::clamp(it->sampleCountdown, 0, numSamples - 1);
                        midiForBlock.addEvent(juce::MidiMessage::noteOff(it->midiChannel, it->midiPitch), offset);
                        midiForBlock.addEvent(juce::MidiMessage::pitchWheel(it->midiChannel, 8192), offset);
                        clearVst3VolumeFades(t->volumeFades, midiForBlock, it->midiChannel, it->midiPitch, offset);
                        it = t->scheduledNoteOffs.erase(it);
                    }
                    else
                    {
                        it->sampleCountdown -= numSamples;
                        ++it;
                    }
                }

                renderVst3Glides(t->pitchGlides, midiForBlock, numSamples);
                renderVst3VolumeFades(t->volumeFades, midiForBlock, numSamples);
            }

            applyPendingVst3Parameters(*t, numSamples);

            int outCh = t->vst3Instrument->getTotalNumOutputChannels();
            int inCh = t->vst3Instrument->getTotalNumInputChannels();
            int reqCh = std::max({ 2, inCh, outCh });

            vst3InstBuffer.setSize(reqCh, numSamples, false, false, true);
            vst3InstBuffer.clear();

            if (safePluginProcessBlock(t->vst3Instrument.get(), vst3InstBuffer, midiForBlock))
            {
                // Safely route to stereo trackBuffer (strictly 2 channels)
                trackBuffer.copyFrom(0, 0, vst3InstBuffer, 0, 0, numSamples);
                if (outCh >= 2)
                    trackBuffer.copyFrom(1, 0, vst3InstBuffer, 1, 0, numSamples);
                else
                    trackBuffer.copyFrom(1, 0, vst3InstBuffer, 0, 0, numSamples);
            }
            else
            {
                trackBuffer.clear();
            }

            float leftGain = t->volume * std::cos((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
            float rightGain = t->volume * std::sin((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
            trackBuffer.applyGain(0, 0, numSamples, leftGain);
            trackBuffer.applyGain(1, 0, numSamples, rightGain);
        }
        else if (t->samplerEnabled)
        {
            if (t->sampleEngine.isReady())
            {
                t->sampleEngine.renderBlock(trackL, trackR, numSamples, 0);

                // Track fader + pan still apply on top of the sampler's own volume/pan
                float leftGain = t->volume * std::cos((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
                float rightGain = t->volume * std::sin((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
                trackBuffer.applyGain(0, 0, numSamples, leftGain);
                trackBuffer.applyGain(1, 0, numSamples, rightGain);
            }
        }
        else
        {
            voiceManager.renderVoices(t->id, trackL, trackR, numSamples, t->pan, t->volume, 0);
            t->drumEngine.renderBlock(trackL, trackR, numSamples, t->pan, t->volume, 0);
        }

        // Per-note VST3 instrument overrides render into the same track bus.
        if (!t->noteVst3Slots.empty())
        {
            float leftGain = t->volume * std::cos((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
            float rightGain = t->volume * std::sin((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);

            for (auto& slot : t->noteVst3Slots)
            {
                if (slot->plugin == nullptr || slot->fxChainId != 0) continue;

                juce::MidiBuffer midiForBlock;
                {
                    std::lock_guard<std::mutex> midiLock(slot->midiMutex);
                    midiForBlock.swapWith(slot->pendingMidi);
                    for (auto it = slot->scheduledNoteOffs.begin(); it != slot->scheduledNoteOffs.end(); )
                    {
                        if (it->sampleCountdown <= numSamples)
                        {
                            int offset = std::clamp(it->sampleCountdown, 0, numSamples - 1);
                            midiForBlock.addEvent(juce::MidiMessage::noteOff(it->midiChannel, it->midiPitch), offset);
                            midiForBlock.addEvent(juce::MidiMessage::pitchWheel(it->midiChannel, 8192), offset);
                            clearVst3VolumeFades(slot->volumeFades, midiForBlock, it->midiChannel, it->midiPitch, offset);
                            it = slot->scheduledNoteOffs.erase(it);
                        }
                        else
                        {
                            it->sampleCountdown -= numSamples;
                            ++it;
                        }
                    }

                    renderVst3Glides(slot->pitchGlides, midiForBlock, numSamples);
                    renderVst3VolumeFades(slot->volumeFades, midiForBlock, numSamples);
                }

                int outCh = slot->plugin->getTotalNumOutputChannels();
                int inCh = slot->plugin->getTotalNumInputChannels();
                int reqCh = std::max({ 2, inCh, outCh });
                vst3InstBuffer.setSize(reqCh, numSamples, false, false, true);
                vst3InstBuffer.clear();

                if (safePluginProcessBlock(slot->plugin.get(), vst3InstBuffer, midiForBlock))
                {
                    vst3InstBuffer.applyGain(0, 0, numSamples, leftGain);
                    vst3InstBuffer.applyGain(outCh >= 2 ? 1 : 0, 0, numSamples, rightGain);
                    trackBuffer.addFrom(0, 0, vst3InstBuffer, 0, 0, numSamples);
                    trackBuffer.addFrom(1, 0, vst3InstBuffer, outCh >= 2 ? 1 : 0, 0, numSamples);
                }
            }
        }

        // Per-note FX chains render outside the track rack: their voices never enter
        // trackBuffer, so a note with its own chain bypasses the track FX entirely.
        if (!t->noteFxChains.empty())
        {
            const float leftGain = t->volume * std::cos((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
            const float rightGain = t->volume * std::sin((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
            float* chainL = noteFxBuffer.getWritePointer(0);
            float* chainR = noteFxBuffer.getWritePointer(1);

            for (auto& chainEntry : t->noteFxChains)
            {
                auto& chain = *chainEntry.second;
                noteFxBuffer.clear();

                // Pre-fader so the chain hears the instrument at unity, like a per-note insert.
                voiceManager.renderVoices(t->id, chainL, chainR, numSamples, 0.0f, 1.0f, chainEntry.first);
                t->drumEngine.renderBlock(chainL, chainR, numSamples, 0.0f, 1.0f, chainEntry.first);
                t->sampleEngine.renderBlock(chainL, chainR, numSamples, chainEntry.first);

                // Per-note VST3 instrument overrides tagged with this chain render here too.
                for (auto& slot : t->noteVst3Slots)
                {
                    if (slot->plugin == nullptr || slot->fxChainId != chainEntry.first) continue;

                    juce::MidiBuffer slotMidi;
                    {
                        std::lock_guard<std::mutex> midiLock(slot->midiMutex);
                        slotMidi.swapWith(slot->pendingMidi);
                        for (auto it = slot->scheduledNoteOffs.begin(); it != slot->scheduledNoteOffs.end(); )
                        {
                            if (it->sampleCountdown <= numSamples)
                            {
                                const int offset = std::clamp(it->sampleCountdown, 0, numSamples - 1);
                                slotMidi.addEvent(juce::MidiMessage::noteOff(it->midiChannel, it->midiPitch), offset);
                                slotMidi.addEvent(juce::MidiMessage::pitchWheel(it->midiChannel, 8192), offset);
                                clearVst3VolumeFades(slot->volumeFades, slotMidi, it->midiChannel, it->midiPitch, offset);
                                it = slot->scheduledNoteOffs.erase(it);
                            }
                            else
                            {
                                it->sampleCountdown -= numSamples;
                                ++it;
                            }
                        }

                        renderVst3Glides(slot->pitchGlides, slotMidi, numSamples);
                        renderVst3VolumeFades(slot->volumeFades, slotMidi, numSamples);
                    }

                    const int outCh = slot->plugin->getTotalNumOutputChannels();
                    const int inCh = slot->plugin->getTotalNumInputChannels();
                    const int reqCh = std::max({ 2, inCh, outCh });
                    fxWetBuffer.setSize(reqCh, numSamples, false, false, true);
                    fxWetBuffer.clear();

                    if (safePluginProcessBlock(slot->plugin.get(), fxWetBuffer, slotMidi))
                    {
                        noteFxBuffer.addFrom(0, 0, fxWetBuffer, 0, 0, numSamples);
                        noteFxBuffer.addFrom(1, 0, fxWetBuffer, outCh >= 2 ? 1 : 0, 0, numSamples);
                    }
                }

                if (chain.steps.empty())
                {
                    // Only unsupported (custom JS) steps: fall back to the track rack.
                    noteFxBuffer.applyGain(0, 0, numSamples, leftGain);
                    noteFxBuffer.applyGain(1, 0, numSamples, rightGain);
                    trackBuffer.addFrom(0, 0, noteFxBuffer, 0, 0, numSamples);
                    trackBuffer.addFrom(1, 0, noteFxBuffer, 1, 0, numSamples);
                    continue;
                }

                juce::dsp::AudioBlock<float> chainBlock(noteFxBuffer);
                for (auto& step : chain.steps)
                {
                    if (step->bypassed) continue;

                    if (step->vst3 != nullptr)
                    {
                        int inCh = step->vst3->getTotalNumInputChannels();
                        int outCh = step->vst3->getTotalNumOutputChannels();
                        int reqCh = std::max({ 2, inCh, outCh });
                        fxWetBuffer.setSize(reqCh, numSamples, false, false, true);
                        fxWetBuffer.clear();

                        if (inCh >= 2)
                        {
                            fxWetBuffer.copyFrom(0, 0, noteFxBuffer, 0, 0, numSamples);
                            fxWetBuffer.copyFrom(1, 0, noteFxBuffer, 1, 0, numSamples);
                        }
                        else if (inCh == 1)
                        {
                            auto* monoIn = fxWetBuffer.getWritePointer(0);
                            const auto* l = noteFxBuffer.getReadPointer(0);
                            const auto* r = noteFxBuffer.getReadPointer(1);
                            for (int s = 0; s < numSamples; ++s)
                                monoIn[s] = 0.5f * (l[s] + r[s]);
                        }
                        else
                        {
                            fxWetBuffer.copyFrom(0, 0, noteFxBuffer, 0, 0, numSamples);
                            if (reqCh >= 2)
                                fxWetBuffer.copyFrom(1, 0, noteFxBuffer, 1, 0, numSamples);
                        }

                        juce::MidiBuffer emptyChainMidi;
                        if (safePluginProcessBlock(step->vst3.get(), fxWetBuffer, emptyChainMidi))
                        {
                            const float wetAmt = juce::jlimit(0.0f, 1.0f, step->wet);
                            const float dryAmt = 1.0f - wetAmt;
                            const float* wetL = fxWetBuffer.getReadPointer(0);
                            const float* wetR = (outCh >= 2) ? fxWetBuffer.getReadPointer(1) : wetL;
                            float* destL = noteFxBuffer.getWritePointer(0);
                            float* destR = noteFxBuffer.getWritePointer(1);
                            for (int s = 0; s < numSamples; ++s)
                            {
                                destL[s] = destL[s] * dryAmt + wetL[s] * wetAmt;
                                destR[s] = destR[s] * dryAmt + wetR[s] * wetAmt;
                            }
                        }
                        else
                        {
                            step->bypassed = true;
                            juce::Logger::writeToLog("[AudioEngine] Note FX VST3 crashed: " + step->pluginName);
                        }
                    }
                    else if (step->eq) step->eq->process(noteFxBuffer);
                    else if (step->distortion) step->distortion->process(chainBlock);
                    else if (step->bitcrush) step->bitcrush->process(noteFxBuffer);
                    else if (step->filter) step->filter->process(chainBlock);
                    else if (step->chorus) step->chorus->process(noteFxBuffer);
                    else if (step->phaser) step->phaser->process(noteFxBuffer);
                    else if (step->delay) step->delay->process(chainBlock);
                    else if (step->dpreverb) step->dpreverb->process(chainBlock);
                    else if (step->reverb) step->reverb->process(chainBlock);
                    else if (step->freeverb) step->freeverb->process(chainBlock);
                }

                noteFxBuffer.applyGain(0, 0, numSamples, leftGain);
                noteFxBuffer.applyGain(1, 0, numSamples, rightGain);
                noteFxMixBuffer.addFrom(0, 0, noteFxBuffer, 0, 0, numSamples);
                noteFxMixBuffer.addFrom(1, 0, noteFxBuffer, 1, 0, numSamples);
            }
        }

        // Process the track FX rack. The UI supplies an ordered instance list (including
        // duplicates and VST3 steps) through setTrackFxChain; older sessions without one
        // keep the fixed legacy sequence below.
        juce::dsp::AudioBlock<float> trackBlock(trackBuffer);
        if (t->fxRackActive)
        {
            juce::MidiBuffer emptyMidi;
            for (auto& step : t->fxRack)
            {
                if (step->bypassed) continue;

                if (step->vst3 != nullptr)
                {
                    const int inCh = step->vst3->getTotalNumInputChannels();
                    const int outCh = step->vst3->getTotalNumOutputChannels();
                    const int reqCh = std::max({ 2, inCh, outCh });

                    fxWetBuffer.setSize(reqCh, numSamples, false, false, true);
                    fxWetBuffer.clear();
                    if (inCh >= 2)
                    {
                        fxWetBuffer.copyFrom(0, 0, trackBuffer, 0, 0, numSamples);
                        fxWetBuffer.copyFrom(1, 0, trackBuffer, 1, 0, numSamples);
                    }
                    else if (inCh == 1)
                    {
                        auto* monoIn = fxWetBuffer.getWritePointer(0);
                        const auto* l = trackBuffer.getReadPointer(0);
                        const auto* r = trackBuffer.getReadPointer(1);
                        for (int s = 0; s < numSamples; ++s)
                            monoIn[s] = 0.5f * (l[s] + r[s]);
                    }
                    else
                    {
                        fxWetBuffer.copyFrom(0, 0, trackBuffer, 0, 0, numSamples);
                        if (reqCh >= 2)
                            fxWetBuffer.copyFrom(1, 0, trackBuffer, 1, 0, numSamples);
                    }

                    if (step->wet > 0.0001f && safePluginProcessBlock(step->vst3.get(), fxWetBuffer, emptyMidi))
                    {
                        const float wetAmt = juce::jlimit(0.0f, 1.0f, step->wet);
                        const float dryAmt = 1.0f - wetAmt;
                        const float* wetL = fxWetBuffer.getReadPointer(0);
                        const float* wetR = (outCh >= 2) ? fxWetBuffer.getReadPointer(1) : wetL;
                        float* destL = trackBuffer.getWritePointer(0);
                        float* destR = trackBuffer.getWritePointer(1);
                        for (int s = 0; s < numSamples; ++s)
                        {
                            destL[s] = destL[s] * dryAmt + wetL[s] * wetAmt;
                            destR[s] = destR[s] * dryAmt + wetR[s] * wetAmt;
                        }
                    }
                    else if (step->wet > 0.0001f)
                    {
                        step->bypassed = true;
                        juce::Logger::writeToLog("[AudioEngine] Track FX VST3 crash isolated: " + step->pluginName);
                    }
                }
                else if (step->eq) step->eq->process(trackBuffer);
                else if (step->distortion) step->distortion->process(trackBlock);
                else if (step->bitcrush) step->bitcrush->process(trackBuffer);
                else if (step->filter) step->filter->process(trackBlock);
                else if (step->chorus) step->chorus->process(trackBuffer);
                else if (step->phaser) step->phaser->process(trackBuffer);
                else if (step->delay) step->delay->process(trackBlock);
                else if (step->dpreverb) step->dpreverb->process(trackBlock);
                else if (step->reverb) step->reverb->process(trackBlock);
                else if (step->freeverb) step->freeverb->process(trackBlock);
            }
        }
        else
        {
            t->eq.process(trackBuffer);
            t->distortion.process(trackBlock);
            t->bitcrush.process(trackBuffer);
            t->filter.process(trackBlock);
            t->chorus.process(trackBuffer);
            t->phaser.process(trackBuffer);
            t->delay.process(trackBlock);
            t->dpreverb.process(trackBlock);
            t->reverb.process(trackBlock);
            t->freeverb.process(trackBlock);

            // Legacy standalone VST3 FX chain (sessions that predate the unified rack).
            juce::MidiBuffer emptyMidi;
            for (auto& fx : t->vst3FxChain)
            {
                if (!fx->bypassed && fx->plugin != nullptr && fx->wet > 0.0001f)
                {
                    int inCh = fx->plugin->getTotalNumInputChannels();
                    int outCh = fx->plugin->getTotalNumOutputChannels();
                    int reqCh = std::max({ 2, inCh, outCh });

                    fxWetBuffer.setSize(reqCh, numSamples, false, false, true);
                    fxWetBuffer.clear();

                    if (inCh >= 2)
                    {
                        fxWetBuffer.copyFrom(0, 0, trackBuffer, 0, 0, numSamples);
                        fxWetBuffer.copyFrom(1, 0, trackBuffer, 1, 0, numSamples);
                    }
                    else if (inCh == 1)
                    {
                        auto* monoIn = fxWetBuffer.getWritePointer(0);
                        const auto* l = trackBuffer.getReadPointer(0);
                        const auto* r = trackBuffer.getReadPointer(1);
                        for (int s = 0; s < numSamples; ++s)
                            monoIn[s] = 0.5f * (l[s] + r[s]);
                    }
                    else
                    {
                        fxWetBuffer.copyFrom(0, 0, trackBuffer, 0, 0, numSamples);
                        if (reqCh >= 2)
                            fxWetBuffer.copyFrom(1, 0, trackBuffer, 1, 0, numSamples);
                    }

                    if (safePluginProcessBlock(fx->plugin.get(), fxWetBuffer, emptyMidi))
                    {
                        float wetAmt = juce::jlimit(0.0f, 1.0f, fx->wet);
                        float dryAmt = 1.0f - wetAmt;

                        const float* wetL = fxWetBuffer.getReadPointer(0);
                        const float* wetR = (outCh >= 2) ? fxWetBuffer.getReadPointer(1) : wetL;

                        float* destL = trackBuffer.getWritePointer(0);
                        float* destR = trackBuffer.getWritePointer(1);

                        for (int s = 0; s < numSamples; ++s)
                        {
                            destL[s] = destL[s] * dryAmt + wetL[s] * wetAmt;
                            destR[s] = destR[s] * dryAmt + wetR[s] * wetAmt;
                        }
                    }
                    else
                    {
                        fx->bypassed = true;
                        juce::Logger::writeToLog("[AudioEngine] VST3 FX crash isolated in: " + fx->pluginName + " (bypassed)");
                    }
                }
            }
        }

        // Per-note chain output bypasses the track rack, so it joins the mix here.
        trackBuffer.addFrom(0, 0, noteFxMixBuffer, 0, 0, numSamples);
        trackBuffer.addFrom(1, 0, noteFxMixBuffer, 1, 0, numSamples);

        // Mix into Master output
        const float* finalTrackL = trackBuffer.getReadPointer(0);
        const float* finalTrackR = trackBuffer.getReadPointer(1);
        for (int i = 0; i < numSamples; ++i)
        {
            outL[i] += finalTrackL[i];
            outR[i] += finalTrackR[i];
        }
    }

    // Master fader sits before the ceiling limiter, matching the browser chain.
    if (std::abs(masterVolume - 1.0f) > 0.0001f)
    {
        const float gain = masterVolume;
        for (int i = 0; i < numSamples; ++i)
        {
            outL[i] *= gain;
            outR[i] *= gain;
        }
    }

    // Process Master Limiter (deferred when the offline renderer has to add its click first)
    if (!masterLimiterDeferred.load(std::memory_order_acquire))
    {
        juce::AudioBuffer<float> masterView(outputChannelData, 2, numSamples);
        juce::dsp::AudioBlock<float> masterBlock(masterView);
        masterLimiter.process(masterBlock);
    }
}

void AudioEngine::processMasterLimiterBlock(float* const* channelData, int numChannels, int numSamples)
{
    if (numChannels < 2 || numSamples <= 0) return;
    juce::AudioBuffer<float> view(channelData, 2, numSamples);
    juce::dsp::AudioBlock<float> masterBlock(view);
    masterLimiter.process(masterBlock);
}

// ==============================================================================
// VST3 Hosting Control Implementations
// ==============================================================================

bool AudioEngine::setTrackVst3Instrument(const juce::String& trackId, const juce::String& pluginIdentifier)
{
    // 1. Quick check: is it already loaded?
    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id == trackId)
            {
                if (t->vst3InstrumentIdentifier == pluginIdentifier && t->vst3Instrument != nullptr)
                    return true; // Already active!
                break;
            }
        }
    }

    // 2. Instantiate plugin OUTSIDE the lock to avoid deadlock with the audio thread
    juce::String errorMsg;
    auto inst = vst3Host.instantiatePlugin(pluginIdentifier, currentSampleRate, currentBlockSize, errorMsg);
    if (inst == nullptr)
    {
        juce::Logger::writeToLog("[AudioEngine] Failed to instantiate VST3: " + errorMsg);
        return false;
    }

    juce::Logger::writeToLog("[AudioEngine] Successfully instantiated VST3 instrument: " + inst->getName());

    // 3. Assign to track under the lock
    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        TrackState* targetTrack = nullptr;
        for (auto& t : tracks)
        {
            if (t->id == trackId) { targetTrack = t.get(); break; }
        }
        if (targetTrack == nullptr)
        {
            addTrack(trackId, "synth");
            for (auto& t : tracks)
            {
                if (t->id == trackId) { targetTrack = t.get(); break; }
            }
        }
        if (targetTrack != nullptr)
        {
            if (targetTrack->vst3InstrumentIdentifier == pluginIdentifier && targetTrack->vst3Instrument != nullptr)
                return true;

            targetTrack->vst3InstrumentEditor = nullptr;
            targetTrack->pendingVst3Params.clear();
            targetTrack->vst3ParamRamps.clear();
            targetTrack->vst3Instrument = std::move(inst);
            targetTrack->vst3InstrumentIdentifier = pluginIdentifier;
            targetTrack->vst3InstrumentName = targetTrack->vst3Instrument->getName();
            if (targetTrack->instrument != "drum")
            {
                targetTrack->instrument = "synth";
            }
            return true;
        }
    }
    return false;
}

juce::var AudioEngine::getTrackVst3Parameters(const juce::String& trackId)
{
    juce::Array<juce::var> out;
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        if (t->vst3Instrument == nullptr) break;

        int index = 0;
        for (auto* param : t->vst3Instrument->getParameters())
        {
            if (param == nullptr) { ++index; continue; }

            auto* obj = new juce::DynamicObject();
            obj->setProperty("index", index);
            obj->setProperty("name", param->getName(96));
            obj->setProperty("label", param->getLabel());
            obj->setProperty("value", (double)param->getValue());
            obj->setProperty("valueText", param->getText(param->getValue(), 32));

            if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(param))
            {
                const auto& range = ranged->getNormalisableRange();
                obj->setProperty("min", (double)range.start);
                obj->setProperty("max", (double)range.end);
                obj->setProperty("default", (double)range.convertFrom0to1(ranged->getDefaultValue()));
                obj->setProperty("discrete", range.interval > 0.0f);
            }

            out.add(juce::var(obj));
            ++index;
        }
        break;
    }
    return juce::var(out);
}

void AudioEngine::setTrackVst3Parameter(const juce::String& trackId, int index, float value, float rampSeconds)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        const int samples = rampSeconds > 0.0f
            ? juce::jmax(1, (int)(rampSeconds * (float)currentSampleRate)) : 0;
        // A stalled audio device must not let the UI queue grow without bound.
        if (t->pendingVst3Params.size() > 512)
            t->pendingVst3Params.erase(t->pendingVst3Params.begin());
        t->pendingVst3Params.push_back({ index, juce::jlimit(0.0f, 1.0f, value), samples });
        break;
    }
}

void AudioEngine::removeTrackVst3Instrument(const juce::String& trackId)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            {
                std::lock_guard<std::mutex> midiLock(t->midiMutex);
                t->scheduledNoteOffs.clear();
                t->pitchGlides.clear();
                t->volumeFades.clear();
            }
            t->pendingVst3Params.clear();
            t->vst3ParamRamps.clear();
            t->vst3InstrumentEditor = nullptr;
            t->vst3Instrument = nullptr;
            t->vst3InstrumentIdentifier = "";
            t->vst3InstrumentName = "";
            if (t->instrument != "drum")
            {
                t->instrument = "synth";
            }
            break;
        }
    }
}

bool AudioEngine::ensureNoteVst3Instrument(const juce::String& trackId, const juce::String& pluginIdentifier,
                                            const juce::String& instanceKey)
{
    if (pluginIdentifier.isEmpty()) return false;

    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id != trackId) continue;
            for (auto& slot : t->noteVst3Slots)
                if (slot->identifier == pluginIdentifier && slot->instanceKey == instanceKey
                    && slot->plugin != nullptr)
                    return true;
            break;
        }
    }

    juce::String errorMsg;
    auto inst = vst3Host.instantiatePlugin(pluginIdentifier, currentSampleRate, currentBlockSize, errorMsg);
    if (inst == nullptr)
    {
        juce::Logger::writeToLog("[AudioEngine] Failed to instantiate per-note VST3 " + pluginIdentifier + ": " + errorMsg);
        return false;
    }
    inst->enableAllBuses();
    inst->setRateAndBufferSizeDetails(currentSampleRate, currentBlockSize);
    inst->prepareToPlay(currentSampleRate, currentBlockSize);

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    TrackState* targetTrack = nullptr;
    for (auto& t : tracks)
        if (t->id == trackId) { targetTrack = t.get(); break; }

    if (targetTrack == nullptr)
    {
        addTrack(trackId, "synth");
        for (auto& t : tracks)
            if (t->id == trackId) { targetTrack = t.get(); break; }
    }
    if (targetTrack == nullptr) return false;

    for (auto& slot : targetTrack->noteVst3Slots)
        if (slot->identifier == pluginIdentifier && slot->instanceKey == instanceKey
            && slot->plugin != nullptr)
            return true;

    auto slot = std::make_unique<TrackState::NoteVst3Slot>();
    slot->identifier = pluginIdentifier;
    slot->name = inst->getName();
    slot->instanceKey = instanceKey;
    slot->plugin = std::move(inst);
    targetTrack->noteVst3Slots.push_back(std::move(slot));
    juce::Logger::writeToLog("[AudioEngine] Loaded per-note VST3: " + pluginIdentifier
                             + (instanceKey.isNotEmpty() ? " (" + instanceKey + ")" : ""));
    return true;
}

void AudioEngine::releaseNoteVst3Instruments(const juce::String& trackId)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        for (auto& slot : t->noteVst3Slots)
        {
            std::lock_guard<std::mutex> midiLock(slot->midiMutex);
            slot->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(1), 0);
            slot->scheduledNoteOffs.clear();
            slot->pitchGlides.clear();
            slot->volumeFades.clear();
            slot->editorWindow.reset();
        }
        t->noteVst3Slots.clear();
        break;
    }
}

void AudioEngine::pruneNoteVst3Instruments(const juce::String& trackId, const juce::var& activeInstanceKeys)
{
    std::set<juce::String> active;
    if (auto* arr = activeInstanceKeys.getArray())
        for (const auto& key : *arr)
            active.insert(key.toString());

    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id != trackId) continue;
        for (auto it = t->noteVst3Slots.begin(); it != t->noteVst3Slots.end();)
        {
            // Only per-note slots are pruned; chain-keyed slots follow pruneNoteFxChains.
            if ((*it)->instanceKey.isNotEmpty() && active.count((*it)->instanceKey) == 0)
            {
                (*it)->editorWindow.reset();
                it = t->noteVst3Slots.erase(it);
            }
            else
            {
                ++it;
            }
        }
        break;
    }
}

void AudioEngine::openTrackVst3InstrumentEditor(const juce::String& trackId)
{
    juce::MessageManager::callAsync([this, trackId]() {
        juce::AudioPluginInstance* instPtr = nullptr;
        juce::String title;
        {
            std::lock_guard<std::recursive_mutex> lock(trackMutex);
            for (auto& t : tracks)
            {
                if (t->id == trackId && t->vst3Instrument != nullptr)
                {
                    if (t->vst3InstrumentEditor != nullptr)
                    {
                        t->vst3InstrumentEditor->setVisible(true);
                        t->vst3InstrumentEditor->toFront(true);
                        return;
                    }
                    instPtr = t->vst3Instrument.get();
                    title = t->vst3InstrumentName.isNotEmpty() ? t->vst3InstrumentName : "VST3 Instrument";
                    break;
                }
            }
        }

        if (instPtr == nullptr) return;

        auto newWin = std::make_unique<Vst3PluginWindow>(
            instPtr,
            title,
            [this, trackId]() {
                juce::MessageManager::callAsync([this, trackId]() {
                    std::lock_guard<std::recursive_mutex> lock(trackMutex);
                    for (auto& trk : tracks) {
                        if (trk->id == trackId) {
                            trk->vst3InstrumentEditor.reset();
                            return;
                        }
                    }
                });
            }
        );

        {
            std::lock_guard<std::recursive_mutex> lock(trackMutex);
            for (auto& t : tracks)
            {
                if (t->id == trackId && t->vst3Instrument.get() == instPtr)
                {
                    t->vst3InstrumentEditor = std::move(newWin);
                    return;
                }
            }
        }
    });
}

void AudioEngine::openNoteVst3InstrumentEditor(const juce::String& trackId, const juce::String& instanceKey)
{
    if (instanceKey.isEmpty()) return;

    juce::MessageManager::callAsync([this, trackId, instanceKey]() {
        juce::AudioPluginInstance* instPtr = nullptr;
        juce::String title;
        {
            std::lock_guard<std::recursive_mutex> lock(trackMutex);
            for (auto& t : tracks)
            {
                if (t->id != trackId) continue;
                for (auto& s : t->noteVst3Slots)
                {
                    if (s->instanceKey != instanceKey || s->plugin == nullptr) continue;
                    if (s->editorWindow != nullptr)
                    {
                        s->editorWindow->setVisible(true);
                        s->editorWindow->toFront(true);
                        return;
                    }
                    instPtr = s->plugin.get();
                    title = s->name.isNotEmpty() ? s->name : "VST3 Note Instrument";
                    break;
                }
                break;
            }
        }

        if (instPtr == nullptr) return;

        auto newWin = std::make_unique<Vst3PluginWindow>(
            instPtr,
            title,
            [this, trackId, instanceKey]() {
                juce::MessageManager::callAsync([this, trackId, instanceKey]() {
                    std::lock_guard<std::recursive_mutex> lock(trackMutex);
                    for (auto& trk : tracks)
                    {
                        if (trk->id != trackId) continue;
                        for (auto& s : trk->noteVst3Slots)
                            if (s->instanceKey == instanceKey) { s->editorWindow.reset(); return; }
                        return;
                    }
                });
            }
        );

        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id != trackId) continue;
            for (auto& s : t->noteVst3Slots)
                if (s->instanceKey == instanceKey && s->plugin.get() == instPtr)
                {
                    s->editorWindow = std::move(newWin);
                    return;
                }
            return;
        }
    });
}

bool AudioEngine::addTrackVst3Fx(const juce::String& trackId, const juce::String& fxId, const juce::String& pluginIdentifier)
{
    // 1. Quick check: does the FX already exist?
    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id == trackId)
            {
                for (auto& existing : t->vst3FxChain)
                {
                    if (existing->fxId == fxId)
                        return true; // Already exists in chain!
                }
                break;
            }
        }
    }

    // 2. Instantiate plugin OUTSIDE the lock to avoid deadlock with the audio thread
    juce::String errorMsg;
    auto inst = vst3Host.instantiatePlugin(pluginIdentifier, currentSampleRate, currentBlockSize, errorMsg);
    if (inst == nullptr)
    {
        juce::Logger::writeToLog("[AudioEngine] Failed to instantiate VST3 FX (" + pluginIdentifier + "): " + errorMsg);
        return false;
    }
    juce::Logger::writeToLog("[AudioEngine] Successfully instantiated VST3 FX: " + inst->getName() + " on track: " + trackId);

    // 3. Build FX slot and assign under the lock
    auto fx = std::make_unique<TrackVst3Fx>();
    fx->fxId = fxId;
    fx->pluginIdentifier = pluginIdentifier;
    fx->pluginName = inst->getName();
    fx->plugin = std::move(inst);
    fx->bypassed = false;
    fx->wet = 0.4f;

    {
        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        TrackState* targetTrack = nullptr;
        for (auto& t : tracks)
        {
            if (t->id == trackId) { targetTrack = t.get(); break; }
        }
        if (targetTrack == nullptr)
        {
            addTrack(trackId, "synth");
            for (auto& t : tracks)
            {
                if (t->id == trackId) { targetTrack = t.get(); break; }
            }
        }
        if (targetTrack != nullptr)
        {
            for (auto& existing : targetTrack->vst3FxChain)
            {
                if (existing->fxId == fxId)
                {
                    existing->plugin = std::move(fx->plugin);
                    existing->pluginIdentifier = pluginIdentifier;
                    existing->pluginName = fx->pluginName;
                    existing->bypassed = fx->bypassed;
                    existing->wet = fx->wet;
                    return true;
                }
            }
            targetTrack->vst3FxChain.push_back(std::move(fx));
            return true;
        }
    }
    return false;
}

void AudioEngine::removeTrackVst3Fx(const juce::String& trackId, const juce::String& fxId)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            for (auto it = t->vst3FxChain.begin(); it != t->vst3FxChain.end(); ++it)
            {
                if ((*it)->fxId == fxId)
                {
                    t->vst3FxChain.erase(it);
                    break;
                }
            }
            break;
        }
    }
}

void AudioEngine::setTrackVst3FxBypass(const juce::String& trackId, const juce::String& fxId, bool bypassed)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            for (auto& fx : t->vst3FxChain)
            {
                if (fx->fxId == fxId)
                {
                    fx->bypassed = bypassed;
                    if (bypassed && fx->plugin != nullptr)
                    {
                        fx->plugin->reset();
                    }
                    break;
                }
            }
            for (auto& step : t->fxRack)
            {
                if (step->type == "vst3" && step->fxId == fxId)
                {
                    step->bypassed = bypassed;
                    if (bypassed && step->vst3 != nullptr)
                        step->vst3->reset();
                    break;
                }
            }
            break;
        }
    }
}

void AudioEngine::setTrackVst3FxWet(const juce::String& trackId, const juce::String& fxId, float wet)
{
    std::lock_guard<std::recursive_mutex> lock(trackMutex);
    for (auto& t : tracks)
    {
        if (t->id == trackId)
        {
            for (auto& fx : t->vst3FxChain)
            {
                if (fx->fxId == fxId)
                {
                    fx->wet = juce::jlimit(0.0f, 1.0f, wet);
                    break;
                }
            }
            for (auto& step : t->fxRack)
            {
                if (step->type == "vst3" && step->fxId == fxId)
                {
                    step->wet = juce::jlimit(0.0f, 1.0f, wet);
                    break;
                }
            }
            break;
        }
    }
}

void AudioEngine::openTrackVst3FxEditor(const juce::String& trackId, const juce::String& fxId)
{
    juce::MessageManager::callAsync([this, trackId, fxId]() {
        juce::AudioPluginInstance* pluginPtr = nullptr;
        juce::String title;
        {
            std::lock_guard<std::recursive_mutex> lock(trackMutex);
            for (auto& t : tracks)
            {
                if (t->id != trackId) continue;

                for (auto& step : t->fxRack)
                {
                    if (step->type == "vst3" && step->fxId == fxId && step->vst3 != nullptr)
                    {
                        if (step->editorWindow != nullptr)
                        {
                            step->editorWindow->setVisible(true);
                            step->editorWindow->toFront(true);
                            return;
                        }
                        pluginPtr = step->vst3.get();
                        title = step->pluginName.isNotEmpty() ? step->pluginName : "VST3 Effect";
                        break;
                    }
                }

                if (pluginPtr == nullptr)
                {
                    for (auto& fx : t->vst3FxChain)
                    {
                        if (fx->fxId == fxId && fx->plugin != nullptr)
                        {
                            if (fx->editorWindow != nullptr)
                            {
                                fx->editorWindow->setVisible(true);
                                fx->editorWindow->toFront(true);
                                return;
                            }
                            pluginPtr = fx->plugin.get();
                            title = fx->pluginName.isNotEmpty() ? fx->pluginName : "VST3 Effect";
                            break;
                        }
                    }
                }
                break;
            }
        }

        if (pluginPtr == nullptr) return;

        auto newWin = std::make_unique<Vst3PluginWindow>(
            pluginPtr,
            title,
            [this, trackId, fxId]() {
                juce::MessageManager::callAsync([this, trackId, fxId]() {
                    std::lock_guard<std::recursive_mutex> lock(trackMutex);
                    for (auto& trk : tracks)
                    {
                        if (trk->id != trackId) continue;
                        for (auto& step : trk->fxRack)
                        {
                            if (step->type == "vst3" && step->fxId == fxId)
                            {
                                step->editorWindow.reset();
                                return;
                            }
                        }
                        for (auto& f : trk->vst3FxChain)
                        {
                            if (f->fxId == fxId)
                            {
                                f->editorWindow.reset();
                                return;
                            }
                        }
                        return;
                    }
                });
            }
        );

        std::lock_guard<std::recursive_mutex> lock(trackMutex);
        for (auto& t : tracks)
        {
            if (t->id != trackId) continue;
            for (auto& step : t->fxRack)
            {
                if (step->type == "vst3" && step->fxId == fxId && step->vst3.get() == pluginPtr)
                {
                    step->editorWindow = std::move(newWin);
                    return;
                }
            }
            for (auto& fx : t->vst3FxChain)
            {
                if (fx->fxId == fxId && fx->plugin.get() == pluginPtr)
                {
                    fx->editorWindow = std::move(newWin);
                    return;
                }
            }
            return;
        }
    });
}

void AudioEngine::openStandaloneVst3Editor(const juce::String& pluginIdentifier)
{
    juce::MessageManager::callAsync([this, pluginIdentifier]() {
        auto itInst = standaloneInstances.find(pluginIdentifier);
        if (itInst == standaloneInstances.end() || itInst->second == nullptr)
        {
            juce::String err;
            auto inst = vst3Host.instantiatePlugin(pluginIdentifier, currentSampleRate, currentBlockSize, err);
            if (inst == nullptr)
            {
                juce::Logger::writeToLog("[AudioEngine] Failed to instantiate standalone VST3: " + err);
                return;
            }
            standaloneInstances[pluginIdentifier] = std::move(inst);
        }

        if (standaloneWindows[pluginIdentifier] != nullptr)
        {
            standaloneWindows[pluginIdentifier]->setVisible(true);
            standaloneWindows[pluginIdentifier]->toFront(true);
            return;
        }

        auto& inst = standaloneInstances[pluginIdentifier];
        juce::String title = inst->getName();
        standaloneWindows[pluginIdentifier] = std::make_unique<Vst3PluginWindow>(
            inst.get(),
            title + " (Preview)",
            [this, pluginIdentifier]() {
                juce::MessageManager::callAsync([this, pluginIdentifier]() {
                    standaloneWindows[pluginIdentifier].reset();
                });
            }
        );
    });
}

