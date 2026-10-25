#include "AudioEngine.h"

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
    }
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

    if (targetTrack->samplerEnabled && targetTrack->vst3Instrument == nullptr)
    {
        targetTrack->sampleEngine.noteOn(noteId, pitchMidi, velocity, durationSeconds, pitchOffsetSemitones);
    }
    else if (inst == "vst3" || targetTrack->vst3Instrument != nullptr)
    {
        std::lock_guard<std::mutex> midiLock(targetTrack->midiMutex);
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
        targetTrack->pendingMidi.addEvent(juce::MidiMessage::noteOn(1, midiPitch, (juce::uint8)midiVel), 0);

        if (durationSeconds > 0.0f)
        {
            int samples = std::max(1, (int)(durationSeconds * currentSampleRate));
            targetTrack->scheduledNoteOffs.push_back({ midiPitch, samples });
        }
    }
    else if (inst == "drum")
    {
        targetTrack->drumEngine.triggerHit((int)pitchMidi, velocity, pitchOffsetSemitones, drumDecay, slideSemitones, slideTimeSeconds, punchOctaves, resonanceHz);
    }
    else if (inst == "physical")
    {
        voiceManager.noteOnPhysical(trackId, noteId, pitchMidi, velocity, durationSeconds);
    }
    else if (inst == "vocal")
    {
        voiceManager.noteOnVocal(trackId, noteId, pitchMidi, velocity, durationSeconds, lyric);
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
                t->pendingMidi.addEvent(juce::MidiMessage::noteOff(1, midiPitch), 0);
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
                t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
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
            t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
            t->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(1), 0);
            t->scheduledNoteOffs.clear();
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
            t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
            t->pendingMidi.addEvent(juce::MidiMessage::allSoundOff(1), 0);
        }
        t->scheduledNoteOffs.clear();
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
                        midiForBlock.addEvent(juce::MidiMessage::noteOff(1, it->midiPitch), offset);
                        it = t->scheduledNoteOffs.erase(it);
                    }
                    else
                    {
                        it->sampleCountdown -= numSamples;
                        ++it;
                    }
                }
            }
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
                t->sampleEngine.renderBlock(trackL, trackR, numSamples);

                // Track fader + pan still apply on top of the sampler's own volume/pan
                float leftGain = t->volume * std::cos((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
                float rightGain = t->volume * std::sin((t->pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
                trackBuffer.applyGain(0, 0, numSamples, leftGain);
                trackBuffer.applyGain(1, 0, numSamples, rightGain);
            }
        }
        else
        {
            voiceManager.renderVoices(t->id, trackL, trackR, numSamples, t->pan, t->volume);
            t->drumEngine.renderBlock(trackL, trackR, numSamples, t->pan, t->volume);
        }

        // Process Track Native FX Rack
        juce::dsp::AudioBlock<float> trackBlock(trackBuffer);
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

        // Process Track VST3 FX Chain (with SEH crash protection & robust multi-channel routing)
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

                // Supply stereo track audio to input channels
                if (inCh >= 2)
                {
                    fxWetBuffer.copyFrom(0, 0, trackBuffer, 0, 0, numSamples);
                    fxWetBuffer.copyFrom(1, 0, trackBuffer, 1, 0, numSamples);
                }
                else if (inCh == 1)
                {
                    // Mono effect input: average stereo to mono
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

        // Mix into Master output
        const float* finalTrackL = trackBuffer.getReadPointer(0);
        const float* finalTrackR = trackBuffer.getReadPointer(1);
        for (int i = 0; i < numSamples; ++i)
        {
            outL[i] += finalTrackL[i];
            outR[i] += finalTrackR[i];
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
            }
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
                if (t->id == trackId)
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
                    break;
                }
            }
        }

        if (pluginPtr == nullptr) return;

        auto newWin = std::make_unique<Vst3PluginWindow>(
            pluginPtr,
            title,
            [this, trackId, fxId]() {
                juce::MessageManager::callAsync([this, trackId, fxId]() {
                    std::lock_guard<std::recursive_mutex> lock(trackMutex);
                    for (auto& trk : tracks) {
                        if (trk->id == trackId) {
                            for (auto& f : trk->vst3FxChain) {
                                if (f->fxId == fxId) {
                                    f->editorWindow.reset();
                                    return;
                                }
                            }
                        }
                    }
                });
            }
        );

        {
            std::lock_guard<std::recursive_mutex> lock(trackMutex);
            for (auto& t : tracks)
            {
                if (t->id == trackId)
                {
                    for (auto& fx : t->vst3FxChain)
                    {
                        if (fx->fxId == fxId && fx->plugin.get() == pluginPtr)
                        {
                            fx->editorWindow = std::move(newWin);
                            return;
                        }
                    }
                }
            }
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

