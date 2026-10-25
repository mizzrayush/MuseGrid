#include "OfflineRenderer.h"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <vector>

namespace
{
    // 128 keeps onset error under 3 ms while staying a block size VST3 plugins expect.
    constexpr int kOfflineBlockSize = 128;

    float readFloat(const juce::DynamicObject* obj, const char* key, float fallback)
    {
        if (!obj->hasProperty(key)) return fallback;
        const auto v = obj->getProperty(key);
        if (v.isBool()) return v ? 1.0f : 0.0f;
        return (float)v;
    }

    double peakOf(const juce::AudioBuffer<float>& buffer, int numSamples)
    {
        double peak = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            const auto* data = buffer.getReadPointer(ch);
            for (int i = 0; i < numSamples; ++i)
                peak = std::max(peak, (double)std::abs(data[i]));
        }
        return peak;
    }

    constexpr double kTicksPerBeat = 192.0;
    // Tone's exponential ramps cover ~99.5% of the distance in their stated time.
    constexpr double kExponentialApproach = 5.298317366548;

    double dbToGain(double db)
    {
        return std::pow(10.0, db / 20.0);
    }

    double parsePitchHz(const juce::String& text, double fallback)
    {
        const auto trimmed = text.trim();
        if (trimmed.isEmpty()) return fallback;

        // A bare number is read as Hz, matching Tone.Frequency.
        if (trimmed.containsOnly("0123456789."))
        {
            const double hz = trimmed.getDoubleValue();
            return hz > 0.0 ? hz : fallback;
        }

        const auto upper = trimmed.toUpperCase();
        int semitone = -1;
        switch ((int)upper[0])
        {
            case 'C': semitone = 0; break;
            case 'D': semitone = 2; break;
            case 'E': semitone = 4; break;
            case 'F': semitone = 5; break;
            case 'G': semitone = 7; break;
            case 'A': semitone = 9; break;
            case 'B': semitone = 11; break;
            default: return fallback;
        }

        int accidental = 0;
        int octaveStart = 1;
        if (trimmed.length() > 1)
        {
            if (trimmed[1] == '#') { accidental = 1; octaveStart = 2; }
            else if (trimmed[1] == 'b') { accidental = -1; octaveStart = 2; }
        }

        const auto octaveText = trimmed.substring(octaveStart).trim();
        const int octave = octaveText.isEmpty() ? 4 : octaveText.getIntValue();
        const int midi = (octave + 1) * 12 + semitone + accidental;
        return 440.0 * std::pow(2.0, (midi - 69) / 12.0);
    }

    // Monophonic MembraneSynth-style click: exponential pitch drop plus an ADSR that follows the
    // Click panel, retriggered from its current level like Tone does.
    class ClickVoice
    {
    public:
        void prepare(const OfflineRenderer::MetronomeConfig& settings, double sampleRateHz)
        {
            cfg = settings;
            sr = sampleRateHz > 0.0 ? sampleRateHz : 44100.0;

            const double beatsPerSecond = std::max(0.001, cfg.bpm / 60.0);
            gateSamples = std::max(1, (int)std::llround((0.125 / beatsPerSecond) * sr));
            attackSamples = std::max(0, (int)std::llround(cfg.attack * sr));
            attackCoeff = coefficientFor(cfg.attack);
            decayCoeff = coefficientFor(cfg.decay);
            releaseCoeff = coefficientFor(cfg.release);
            gain = dbToGain(cfg.gainDb);
            sustain = juce::jlimit(0.0, 1.0, cfg.sustain);
            reset();
        }

        void reset()
        {
            active = false;
            releasing = false;
            phase = 0.0;
            env = 0.0;
            age = 0;
            baseFreq = 1000.0;
            velocity = 0.0;
        }

        void trigger(double frequency, double clickVelocity)
        {
            const bool wasActive = active;
            baseFreq = frequency > 0.0 ? frequency : 1000.0;
            velocity = juce::jlimit(0.0, 1.0, clickVelocity);
            age = 0;
            releasing = false;
            active = true;
            if (!wasActive)
                env = attackSamples > 0 ? 0.0 : velocity;
        }

        float renderSample()
        {
            if (!active) return 0.0f;

            if (!releasing && age >= gateSamples)
                releasing = true;

            if (releasing)
            {
                env += (0.0 - env) * releaseCoeff;
                if (env < 1.0e-5)
                {
                    active = false;
                    env = 0.0;
                    return 0.0f;
                }
            }
            else if (attackSamples > 0 && age < attackSamples)
            {
                env += (velocity - env) * attackCoeff;
            }
            else
            {
                env += (velocity * sustain - env) * decayCoeff;
            }

            const double t = (double)age / sr;
            double freq = baseFreq;
            if (cfg.pitchDecay > 0.0 && t < cfg.pitchDecay && cfg.octaves > 1.0)
                freq = baseFreq * std::pow(cfg.octaves, 1.0 - t / cfg.pitchDecay);

            phase += freq / sr;
            phase -= std::floor(phase);

            const float out = (float)(std::sin(phase * juce::MathConstants<double>::twoPi) * env * gain);
            ++age;
            return out;
        }

    private:
        double coefficientFor(double seconds) const
        {
            if (seconds <= 0.0) return 1.0;
            const double samples = seconds * sr / kExponentialApproach;
            return samples > 0.0 ? 1.0 - std::exp(-1.0 / samples) : 1.0;
        }

        OfflineRenderer::MetronomeConfig cfg;
        double sr = 44100.0;
        bool active = false;
        bool releasing = false;
        double phase = 0.0;
        double env = 0.0;
        double velocity = 0.0;
        double baseFreq = 1000.0;
        double gain = 1.0;
        double sustain = 0.0;
        double attackCoeff = 1.0;
        double decayCoeff = 1.0;
        double releaseCoeff = 1.0;
        int gateSamples = 1;
        int attackSamples = 0;
        int age = 0;
    };

    // Click schedule on the project beat grid, so a bounce of a later range keeps the real
    // downbeats instead of restarting the count at the export start.
    class MetronomePlayer
    {
    public:
        MetronomePlayer(const OfflineRenderer::MetronomeConfig& settings, double sampleRateHz)
            : cfg(settings)
        {
            if (!cfg.enabled) return;

            const double bpm = std::max(1.0, cfg.bpm);
            const double ticksPerSecond = (bpm / 60.0) * kTicksPerBeat;
            samplesPerBeat = std::max(1.0, (60.0 / bpm) * sampleRateHz);

            const double firstBeat = std::ceil(cfg.startTick / kTicksPerBeat - 1.0e-9);
            firstBeatIndex = (long long)firstBeat;
            firstClickSample = std::max(0.0, ((firstBeat * kTicksPerBeat - cfg.startTick) / ticksPerSecond) * sampleRateHz);

            click.prepare(cfg, sampleRateHz);
            resetPass();
        }

        void resetPass()
        {
            if (!cfg.enabled) return;
            click.reset();
            beatIndex = firstBeatIndex;
            nextClickSample = firstClickSample;
        }

        void renderInto(juce::AudioBuffer<float>& buffer, long long blockStart, int numSamples)
        {
            if (!cfg.enabled || numSamples <= 0 || buffer.getNumChannels() < 2) return;

            float* left = buffer.getWritePointer(0);
            float* right = buffer.getWritePointer(1);
            const int beatsPerMeasure = std::max(1, cfg.beatsPerMeasure);
            const double downHz = parsePitchHz(cfg.downbeatPitch, 1046.5);
            const double upHz = parsePitchHz(cfg.upbeatPitch, 783.99);

            for (int i = 0; i < numSamples; ++i)
            {
                const double position = (double)(blockStart + i);
                while (position >= nextClickSample)
                {
                    const bool downbeat = (beatIndex % beatsPerMeasure) == 0;
                    click.trigger(downbeat ? downHz : upHz,
                                  cfg.metronomeVolume * (downbeat ? cfg.downbeatVel : cfg.upbeatVel));
                    ++beatIndex;
                    nextClickSample += samplesPerBeat;
                }

                const float s = click.renderSample();
                left[i] += s;
                right[i] += s;
            }
        }

    private:
        OfflineRenderer::MetronomeConfig cfg;
        double samplesPerBeat = 22050.0;
        long long firstBeatIndex = 0;
        long long beatIndex = 0;
        double firstClickSample = 0.0;
        double nextClickSample = 0.0;
        ClickVoice click;
    };
}

void OfflineRenderer::dispatchNoteOn(AudioEngine& engine, const juce::var& command)
{
    auto* obj = command.getDynamicObject();
    if (obj == nullptr) return;

    engine.playNote(obj->getProperty("trackId").toString(),
                    readFloat(obj, "pitch", 60.0f),
                    readFloat(obj, "velocity", 1.0f),
                    readFloat(obj, "duration", 0.25f),
                    obj->hasProperty("instrument") ? obj->getProperty("instrument").toString() : juce::String(),
                    readFloat(obj, "slideEnd", -1.0f),
                    readFloat(obj, "slideTime", 0.0f),
                    readFloat(obj, "vibratoDepth", 0.0f),
                    readFloat(obj, "vibratoRate", 5.0f),
                    readFloat(obj, "tremoloDepth", 0.0f),
                    readFloat(obj, "tremoloRate", 6.0f),
                    readFloat(obj, "filterStart", -1.0f),
                    readFloat(obj, "filterEnd", -1.0f),
                    readFloat(obj, "filterSweepTime", 0.0f),
                    obj->hasProperty("lyric") ? obj->getProperty("lyric").toString() : juce::String("a"),
                    readFloat(obj, "pitchOffset", 0.0f),
                    readFloat(obj, "drumDecay", -1.0f),
                    readFloat(obj, "slideSemitones", 0.0f),
                    readFloat(obj, "punchOctaves", -1.0f),
                    readFloat(obj, "resonanceHz", -1.0f));
}

OfflineRenderer::Result OfflineRenderer::renderToFile(const RenderJob& job, AudioEngine& engine,
                                                      double liveSampleRate, int liveBlockSize)
{
    Result result;

    if (job.bitDepth != 16 && job.bitDepth != 24 && job.bitDepth != 32)
    {
        result.message = "Unsupported bit depth";
        return result;
    }
    if (job.sampleRate <= 0.0 || job.totalDurationSeconds <= 0.0)
    {
        result.message = "Invalid render range";
        return result;
    }

    const int totalSamples = (int)(job.totalDurationSeconds * job.sampleRate);

    std::vector<juce::var> events;
    events.reserve((size_t)job.events.size());
    for (const auto& ev : job.events)
        if (ev.isObject()) events.push_back(ev);

    std::vector<size_t> order(events.size());
    std::iota(order.begin(), order.end(), (size_t)0);
    std::stable_sort(order.begin(), order.end(), [&events](size_t a, size_t b) {
        return (double)events[a].getDynamicObject()->getProperty("time")
             < (double)events[b].getDynamicObject()->getProperty("time");
    });

    // Solo/mute for the bounce is scoped to the render: captured here, restored by the scope guard.
    struct TrackFlag { juce::String id; bool muted, soloed; };
    std::vector<TrackFlag> restoredFlags;
    for (const auto& o : job.trackOverrides)
    {
        auto* obj = o.getDynamicObject();
        if (obj == nullptr) continue;
        const juce::String trackId = obj->getProperty("trackId").toString();
        restoredFlags.push_back({ trackId, engine.getTrackMute(trackId), engine.getTrackSolo(trackId) });
        if (obj->hasProperty("muted")) engine.setTrackMute(trackId, (bool)obj->getProperty("muted"));
        if (obj->hasProperty("soloed")) engine.setTrackSolo(trackId, (bool)obj->getProperty("soloed"));
    }

    struct Scope
    {
        AudioEngine& eng;
        double rate;
        int block;
        std::vector<TrackFlag>& flags;
        ~Scope()
        {
            eng.allNotesOff();
            for (auto& f : flags)
            {
                eng.setTrackMute(f.id, f.muted);
                eng.setTrackSolo(f.id, f.soloed);
            }
            eng.setMasterLimiterDeferred(false);
            eng.prepareForRate(rate, block);
            eng.setOfflineBusy(false);
        }
    } scope{ engine, liveSampleRate, liveBlockSize, restoredFlags };

    engine.setOfflineBusy(true);
    engine.prepareForRate(job.sampleRate, kOfflineBlockSize);
    engine.setMasterLimiterDeferred(job.metronome.enabled);
    engine.allNotesOff();

    juce::AudioBuffer<float> block(2, kOfflineBlockSize);
    float* const blockPointers[2] = { block.getWritePointer(0), block.getWritePointer(1) };
    MetronomePlayer metronome(job.metronome, job.sampleRate);

    // measureOnly == false renders the bounce for real: gain and fade are applied after the
    // master limiter, matching how the JS path post-processes its AudioBuffer.
    auto runPass = [&](bool measureOnly, double gain, int fadeStart, int fadeSamples,
                       juce::AudioFormatWriter* writer, double& peak)
    {
        peak = 0.0;
        size_t cursor = 0;
        int startSample = 0;
        metronome.resetPass();

        while (startSample < totalSamples)
        {
            const int numSamples = std::min(kOfflineBlockSize, totalSamples - startSample);
            block.clear();

            while (cursor < order.size())
            {
                const auto& ev = events[order[cursor]];
                const double when = (double)ev.getDynamicObject()->getProperty("time");
                if (when * job.sampleRate >= (double)startSample) break;
                dispatchNoteOn(engine, ev);
                ++cursor;
            }

            engine.renderBlock(blockPointers, 2, numSamples);

            // The click has to reach the master limiter with the mix, so the engine deferred it.
            if (job.metronome.enabled)
            {
                metronome.renderInto(block, startSample, numSamples);
                engine.processMasterLimiterBlock(blockPointers, 2, numSamples);
            }

            if (measureOnly)
            {
                peak = std::max(peak, peakOf(block, numSamples));
            }
            else
            {
                double passPeak = 0.0;
                for (int ch = 0; ch < 2; ++ch)
                {
                    auto* data = block.getWritePointer(ch);
                    for (int i = 0; i < numSamples; ++i)
                    {
                        float s = data[i] * (float)gain;
                        const int pos = startSample + i;
                        if (pos >= fadeStart && fadeSamples > 0)
                            s *= (float)(totalSamples - pos) / (float)fadeSamples;
                        data[i] = s;
                        passPeak = std::max(passPeak, (double)std::abs(s));
                    }
                }
                peak = std::max(peak, passPeak);
                writer->writeFromAudioSampleBuffer(block, 0, numSamples);
            }

            startSample += numSamples;
        }
    };

    double gain = 1.0;
    if (job.normalize)
    {
        double peak = 0.0;
        runPass(true, 1.0, 0, 0, nullptr, peak);
        result.peakLinear = peak;
        const double target = std::pow(10.0, job.normalizeTargetDb / 20.0);
        if (peak > 1.0e-6 && target > 0.0)
            gain = target / peak;
    }
    result.appliedGain = gain;

    // Second pass must start from the same graph state as the first, so re-prepare
    // (which resets delay/reverb lines, limiter history and voices) before bouncing.
    engine.allNotesOff();
    engine.prepareForRate(job.sampleRate, kOfflineBlockSize);

    if (job.outputFile.exists())
        job.outputFile.deleteFile();

    std::unique_ptr<juce::OutputStream> outputStream = job.outputFile.createOutputStream();
    if (outputStream == nullptr)
    {
        result.message = "Could not open output file";
        return result;
    }

    juce::WavAudioFormat wavFormat;
    auto writerOptions = juce::AudioFormatWriterOptions{}
        .withSampleRate(job.sampleRate)
        .withNumChannels(2)
        .withBitsPerSample(job.bitDepth);

    auto writer = wavFormat.createWriterFor(outputStream, writerOptions);
    if (writer == nullptr)
    {
        result.message = "Could not create WAV writer";
        return result;
    }

    const int fadeSamples = job.autoFade ? (int)(job.fadeSeconds * job.sampleRate) : 0;
    const int fadeStart = totalSamples - fadeSamples;

    double peak = 0.0;
    runPass(false, gain, fadeStart, fadeSamples, writer.get(), peak);

    result.writtenSamples = totalSamples;
    if (!job.normalize)
        result.peakLinear = peak;

    writer->flush();
    writer.reset();

    result.success = true;
    return result;
}
