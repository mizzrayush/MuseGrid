#include "SampleEngine.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>
#include <thread>
#include <cmath>

SampleEngine::SampleEngine()
{
    voices.resize(MAX_VOICES);
    decayCurve.setExponential(-4.0f);
    releaseCurve.setExponential(-4.0f);
}

void SampleEngine::prepare(double sampleRate)
{
    // Device sample-rate change: rescale live voice positions to the new buffer length.
    const double oldSR = currentSampleRate;
    currentSampleRate = sampleRate;
    atomicSampleRate.store(sampleRate, std::memory_order_relaxed);

    auto* buf = mainBuffer.load(std::memory_order_acquire);
    if (buf != nullptr && oldSR > 0.0 && sampleRate > 0.0 && std::abs(oldSR - sampleRate) > 1.0)
    {
        const double scale = sampleRate / oldSR;
        for (auto& v : voices)
        {
            if (!v.active) continue;
            v.position *= scale;
            v.startIdx *= scale;
            v.endIdx *= scale;
        }
    }
}

void SampleEngine::reset()
{
    for (auto& v : voices) v.active = false;
    readyFlag.store(false, std::memory_order_release);
}

juce::AudioBuffer<float>* SampleEngine::decodeToBuffer(const juce::MemoryBlock& bytes)
{
    if (bytes.getSize() == 0) return nullptr;

    juce::AudioFormatManager afm;
    afm.registerBasicFormats(); // WAV, AIFF, AU

    auto input = std::make_unique<juce::MemoryInputStream>(bytes, false);
    std::unique_ptr<juce::AudioFormatReader> reader(afm.createReaderFor(std::move(input)));
    if (reader == nullptr) return nullptr;

    const int numSamples = (int)reader->lengthInSamples;
    if (numSamples <= 0) return nullptr;

    const int numCh = std::min<int>(2, std::max<int>(1, (int)reader->numChannels));
    auto* buf = new juce::AudioBuffer<float>(numCh, numSamples);
    buf->clear();
    if (!reader->read(buf, 0, numSamples, 0, true, numCh > 1))
    {
        delete buf;
        return nullptr;
    }
    return buf;
}

juce::AudioBuffer<float>* SampleEngine::makeReversed(const juce::AudioBuffer<float>& src)
{
    const int numCh = src.getNumChannels();
    const int numSamples = src.getNumSamples();
    if (numSamples <= 1) return nullptr;

    auto* rev = new juce::AudioBuffer<float>(numCh, numSamples);
    for (int ch = 0; ch < numCh; ++ch)
    {
        const float* in = src.getReadPointer(ch);
        float* out = rev->getWritePointer(ch);
        for (int i = 0; i < numSamples; ++i)
            out[i] = in[numSamples - 1 - i];
    }
    return rev;
}

void SampleEngine::swapBuffers(juce::AudioBuffer<float>* newMain, int hash, int generation)
{
    if (decodeGeneration.load(std::memory_order_relaxed) != generation)
    {
        delete newMain;
        return; // A newer request superseded this decode
    }
    if (newMain == nullptr || newMain->getNumSamples() < 2)
    {
        delete newMain;
        return;
    }

    for (auto& v : voices) v.active = false;

    auto* oldMain = mainBuffer.exchange(newMain, std::memory_order_acq_rel);
    auto* oldRev = reverseBuffer.exchange(makeReversed(*newMain), std::memory_order_acq_rel);
    delete oldMain;
    delete oldRev;

    bufferLoadedHash = hash;
    readyFlag.store(true, std::memory_order_release);
}

void SampleEngine::setConfig(const Config& newConfig, const juce::String& base64Data)
{
    config = newConfig;
    nextVoiceIndex = 0;

    if (base64Data.isEmpty())
    {
        // Config-only tweak: refresh live voices with the new static params.
        for (auto& v : voices)
        {
            if (v.active)
            {
                v.cfg = config;
                v.sustainLevel = config.sustain;
            }
        }
        return;
    }

    // Re-decode only when the sample payload actually changed.
    const int newHash = (int)(juce::uint32)juce::String(base64Data).hash();
    if (newHash == bufferHash && newHash == bufferLoadedHash && readyFlag.load(std::memory_order_acquire))
        return;

    bufferHash = newHash;
    readyFlag.store(false, std::memory_order_release);
    for (auto& v : voices) v.active = false;

    const int generation = decodeGeneration.load(std::memory_order_relaxed) + 1;
    decodeGeneration.store(generation, std::memory_order_relaxed);

    // Strip "data:...;base64," prefix if present
    juce::String b64 = base64Data;
    const int commaIdx = b64.indexOfChar(',');
    if (b64.startsWith("data:") && commaIdx >= 0)
        b64 = b64.substring(commaIdx + 1);

    juce::MemoryOutputStream mos;
    if (!juce::Base64::convertFromBase64(mos, b64))
    {
        juce::Logger::writeToLog("[SampleEngine] Base64 decode failed for sampler payload");
        return;
    }
    juce::MemoryBlock bytes = mos.getMemoryBlock();

    // Decode off the message thread so large samples never block the UI.
    std::thread([this, bytes, newHash, generation]()
    {
        juce::AudioBuffer<float>* decoded = decodeToBuffer(bytes);
        if (decoded == nullptr)
        {
            juce::Logger::writeToLog("[SampleEngine] WAV decode failed for sampler payload");
            return;
        }
        juce::MessageManager::callAsync([this, decoded, newHash, generation]()
        {
            swapBuffers(decoded, newHash, generation);
        });
    }).detach();
}

void SampleEngine::noteOn(int noteId, float pitchMidi, float velocity, float durationSeconds, float pitchOffsetSemitones, int fxChainId,
                          const musegrid::NoteExpression& expression, float targetPitchMidi, float slideTimeSeconds)
{
    if (!readyFlag.load(std::memory_order_acquire)) return;
    auto* buf = mainBuffer.load(std::memory_order_acquire);
    if (buf == nullptr || buf->getNumSamples() < 2) return;

    Voice* v = nullptr;
    for (int i = 0; i < MAX_VOICES; ++i)
    {
        int idx = (nextVoiceIndex + i) % MAX_VOICES;
        if (!voices[(size_t)idx].active) { v = &voices[(size_t)idx]; nextVoiceIndex = (idx + 1) % MAX_VOICES; break; }
    }
    if (v == nullptr)
    {
        // Steal the oldest-sounding voice: prefer released ones, else first active
        int best = -1;
        for (int i = 0; i < MAX_VOICES; ++i)
        {
            if (voices[(size_t)i].stage == EnvStage::Release) { best = i; break; }
        }
        if (best < 0) best = nextVoiceIndex;
        v = &voices[(size_t)best];
        nextVoiceIndex = (best + 1) % MAX_VOICES;
    }

    const float totalSemis = (pitchMidi - (float)config.rootNote) + config.tuning + pitchOffsetSemitones + (config.fineTune / 100.0f);
    double rate = std::pow(2.0, (double)totalSemis / 12.0);
    rate = juce::jlimit(0.05, 16.0, rate);

    const bool hasTarget = targetPitchMidi >= 0.0f && std::abs(targetPitchMidi - pitchMidi) > 0.0005f;
    double targetRate = rate;
    if (hasTarget)
    {
        const float targetSemis = (targetPitchMidi - (float)config.rootNote) + config.tuning + pitchOffsetSemitones + (config.fineTune / 100.0f);
        targetRate = juce::jlimit(0.05, 16.0, std::pow(2.0, (double)targetSemis / 12.0));
    }

    const double dur = (double)buf->getNumSamples();
    double s = juce::jlimit(0.0, 0.98, (double)config.startOffset) * dur;
    double e = juce::jlimit(0.01, 1.0, (double)config.endOffset) * dur;
    if (e <= s + 1.0) e = dur;

    v->active = true;
    v->noteId = noteId;
    v->fxChainId = fxChainId;
    v->rate = rate;
    v->startRate = rate;
    v->targetRate = targetRate;
    v->sliding = hasTarget;
    v->glideSeconds = slideTimeSeconds > 0.0f ? slideTimeSeconds : durationSeconds;
    v->glideElapsed = 0.0f;
    v->glideCurveSize = juce::jlimit(0, musegrid::NoteExpression::kCurvePoints, expression.slideCurveSize);
    for (int i = 0; i < v->glideCurveSize; ++i) v->glideCurve[(size_t)i] = expression.slideCurve[(size_t)i];
    v->steppedGlide = expression.steppedGlide;
    v->elapsedSeconds = 0.0f;
    v->fadeInSeconds = juce::jmax(0.0f, expression.morphFadeInSeconds);
    v->fadeOutSeconds = juce::jmax(0.0f, expression.morphFadeOutSeconds);
    v->gain = juce::jlimit(0.0f, 1.0f, expression.gain);
    v->pan = juce::jlimit(-1.0f, 1.0f, expression.pan);
    v->startIdx = s;
    v->endIdx = e;
    v->velocity = juce::jlimit(0.0f, 2.0f, velocity);
    v->remainingSeconds = durationSeconds > 0.0f ? durationSeconds : -1.0f;
    v->stage = EnvStage::Attack;
    v->stageElapsed = 0.0f;
    v->envValue = 0.0f;
    v->cfg = config;
    v->sustainLevel = config.sustain;
    v->decayAmount = 1.0f - config.sustain;
    v->usingReverse = config.reverse;
    v->bufCh0 = 0;
    v->bufCh1 = buf->getNumChannels() >= 2 ? 1 : 0;
    v->position = config.reverse ? juce::jlimit(0.0, dur - 1.0, dur - 1.0 - e) : s;
}

void SampleEngine::noteOff(int noteId)
{
    for (auto& v : voices)
    {
        if (v.active && v.noteId == noteId && v.stage != EnvStage::Release)
        {
            v.stage = EnvStage::Release;
            v.stageElapsed = 0.0f;
            v.releaseStartLevel = v.envValue;
        }
    }
}

void SampleEngine::allNotesOff()
{
    for (auto& v : voices) v.active = false;
}

static float sampleNoteCurve(const std::array<float, musegrid::NoteExpression::kCurvePoints>& curve, int count, float t)
{
    if (count < 2) return juce::jlimit(0.0f, 1.0f, t);
    const int points = juce::jmin(count, musegrid::NoteExpression::kCurvePoints);
    const float pos = juce::jlimit(0.0f, 1.0f, t) * (float)(points - 1);
    const int i0 = (int)pos;
    const int i1 = juce::jmin(i0 + 1, points - 1);
    const float frac = pos - (float)i0;
    const float value = curve[(size_t)i0] + (curve[(size_t)i1] - curve[(size_t)i0]) * frac;
    return juce::jlimit(0.0f, 1.0f, value);
}

void SampleEngine::renderBlock(float* leftOut, float* rightOut, int numSamples, int fxChainId)
{
    if (!readyFlag.load(std::memory_order_acquire)) return;
    auto* buf = mainBuffer.load(std::memory_order_acquire);
    if (buf == nullptr) return;

    const int bufLen = buf->getNumSamples();
    auto* rev = reverseBuffer.load(std::memory_order_acquire);
    const double sr = atomicSampleRate.load(std::memory_order_relaxed);
    if (sr <= 0.0) return;
    const double sampleTime = 1.0 / sr;

    for (auto& v : voices)
    {
        if (!v.active || v.fxChainId != fxChainId) continue;

        const float panAngle = (juce::jlimit(-1.0f, 1.0f, v.cfg.pan + v.pan) + 1.0f) * juce::MathConstants<float>::pi * 0.25f;
        const float panL = std::cos(panAngle);
        const float panR = std::sin(panAngle);

        const bool isRevVoice = v.usingReverse && rev != nullptr;
        const juce::AudioBuffer<float>* vb = isRevVoice ? rev : buf;
        const int vLen = vb->getNumSamples();
        const int ch0 = isRevVoice ? (v.bufCh1 < vLen ? v.bufCh1 : 0) : v.bufCh0;
        const int ch1 = isRevVoice ? (v.bufCh0 < vLen ? v.bufCh0 : v.bufCh1) : v.bufCh1;
        const float* srcL = vb->getReadPointer(std::min(ch0, vLen - 1));
        const float* srcR = vb->getReadPointer(std::min(ch1, vLen - 1));

        const double posStart = isRevVoice ? (vLen - 1.0 - v.endIdx) : v.startIdx;
        const double posEnd   = isRevVoice ? (vLen - 1.0 - v.startIdx) : v.endIdx;

        for (int i = 0; i < numSamples; ++i)
        {
            v.elapsedSeconds += (float)sampleTime;
            if (v.sliding)
            {
                v.glideElapsed += (float)sampleTime;
                const float glideDur = juce::jmax(0.001f, v.glideSeconds);
                const float gt = juce::jlimit(0.0f, 1.0f, v.glideElapsed / glideDur);
                const float shape = sampleNoteCurve(v.glideCurve, v.glideCurveSize, gt);
                double r = v.startRate * std::pow(v.targetRate / v.startRate, (double)shape);
                if (v.steppedGlide)
                    r = std::pow(2.0, std::round(std::log2(r) * 12.0) / 12.0);
                v.rate = juce::jlimit(0.05, 16.0, r);
                if (gt >= 1.0f) v.sliding = false;
            }

            float morphGain = 1.0f;
            if (v.fadeInSeconds > 0.0001f)
                morphGain *= juce::jlimit(0.0f, 1.0f, v.elapsedSeconds / v.fadeInSeconds);
            if (v.fadeOutSeconds > 0.0001f)
                morphGain *= juce::jlimit(0.0f, 1.0f, 1.0f - v.elapsedSeconds / v.fadeOutSeconds);

            // Envelope
            float env = v.envValue;
            switch (v.stage)
            {
                case EnvStage::Attack:
                {
                    v.stageElapsed += (float)sampleTime;
                    const float att = std::max(0.001f, v.cfg.attack);
                    env = juce::jlimit(0.0f, 1.0f, v.stageElapsed / att);
                    if (v.stageElapsed >= att) { v.stage = EnvStage::Decay; v.stageElapsed = 0.0f; env = 1.0f; }
                    break;
                }
                case EnvStage::Decay:
                {
                    v.stageElapsed += (float)sampleTime;
                    const float dcy = std::max(0.005f, v.cfg.decay);
                    const float p = juce::jlimit(0.0f, 1.0f, v.stageElapsed / dcy);
                    env = v.sustainLevel + v.decayAmount * decayCurve.sample(p);
                    if (p >= 1.0f) { v.stage = EnvStage::Sustain; v.stageElapsed = 0.0f; env = v.sustainLevel; }
                    break;
                }
                case EnvStage::Sustain:
                    env = v.sustainLevel;
                    break;
                case EnvStage::Release:
                {
                    v.stageElapsed += (float)sampleTime;
                    const float rel = std::max(0.005f, v.cfg.release);
                    const float p = juce::jlimit(0.0f, 1.0f, v.stageElapsed / rel);
                    env = v.releaseStartLevel * releaseCurve.sample(p);
                    if (p >= 1.0f)
                    {
                        v.active = false;
                        v.envValue = 0.0f;
                        break;
                    }
                    break;
                }
            }
            if (!v.active) break;
            v.envValue = env;

            // Duration-based auto release (grid notes)
            if (v.remainingSeconds > 0.0f && v.stage != EnvStage::Release)
            {
                v.remainingSeconds -= (float)sampleTime;
                if (v.remainingSeconds <= 0.0f)
                {
                    v.stage = EnvStage::Release;
                    v.stageElapsed = 0.0f;
                    v.releaseStartLevel = env;
                }
            }

            // Sample read with chromatic rate (linear interpolation)
            const double pPos = juce::jlimit(0.0, (double)(vLen - 1), v.position);
            const int i0 = (int)std::floor(pPos);
            const int i1 = juce::jmin(i0 + 1, vLen - 1);
            const float frac = (float)(pPos - (double)i0);
            const float sl = srcL[i0] + (srcL[i1] - srcL[i0]) * frac;
            const float sr_ = srcR[i0] + (srcR[i1] - srcR[i0]) * frac;

            const float gain = env * v.velocity * v.cfg.volume * v.gain * morphGain;
            leftOut[i]  += sl * gain * panL;
            rightOut[i] += sr_ * gain * panR;

            // Position advance (reverse voices read a pre-reversed buffer with negative rate)
            v.position += v.rate;

            if (v.stage == EnvStage::Release) continue;

            if (v.cfg.loop)
            {
                if (v.position >= posEnd || v.position < posStart)
                    v.position = posStart + std::fmod(std::max(0.0, v.position - posStart), std::max(1.0, posEnd - posStart));
            }
            else if (v.position >= posEnd)
            {
                // One-shot reached sample end: natural release
                v.stage = EnvStage::Release;
                v.stageElapsed = 0.0f;
                v.releaseStartLevel = env;
            }
        }
    }
}
