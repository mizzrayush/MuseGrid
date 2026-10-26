#include "SynthVoice.h"

SynthVoice::SynthVoice()
{
}

void SynthVoice::prepare(double sampleRate)
{
    currentSampleRate = sampleRate;
    reset();
}

void SynthVoice::reset()
{
    active = false;
    currentNoteId = -1;
    currentPhase = 0.0;
    envStage = EnvStage::Off;
    envValue = 0.0f;
    isSliding = false;
    slideElapsed = 0.0f;
    expression = {};
    vibratoElapsed = 0.0f;
    tremoloElapsed = 0.0f;
    vibPhase = 0.0;
    tremPhase = 0.0;
    remainingDuration = -1.0f;
    filterState = 0.0f;
    fmPhase = 0.0;
    fmModEnvValue = 0.0f;
    stageElapsed = 0.0f;
    releaseStartLevel = 0.0f;
}

void SynthVoice::setAdsr(float a, float d, float s, float r)
{
    attackTime = juce::jmax(0.001f, a);
    decayTime = juce::jmax(0.001f, d);
    sustainLevel = juce::jlimit(0.0f, 1.0f, s);
    releaseTime = juce::jmax(0.001f, r);
}

void SynthVoice::setFmParams(bool enabled, float harmonicity, float modIndex,
                             float modA, float modD, float modS, float modR)
{
    isFM = enabled;
    fmHarmonicity = harmonicity;
    fmModIndex = modIndex;
    fmModAttack = juce::jmax(0.001f, modA);
    fmModDecay = juce::jmax(0.001f, modD);
    fmModSustain = juce::jlimit(0.0f, 1.0f, modS);
    fmModRelease = juce::jmax(0.001f, modR);
}

void SynthVoice::setPreset(const juce::String& presetName)
{
    isFM = false;
    hasFilterSweep = false;

    if (presetName == "piano")
    {
        setOscType(OscType::Triangle);
        setAdsr(0.004f, 0.28f, 0.16f, 0.36f);
        decayCurve.setExponential(-4.2f);
        releaseCurve.setExponential(-5.0f);
    }
    else if (presetName == "electricPiano")
    {
        setOscType(OscType::Sine);
        setAdsr(0.01f, 0.32f, 0.22f, 0.45f);
        setFmParams(true, 2.4f, 5.8f, 0.01f, 0.18f, 0.10f, 0.20f);
        decayCurve.setExponential(-3.5f);
        releaseCurve.setExponential(-4.0f);
    }
    else if (presetName == "marimba")
    {
        setOscType(OscType::Sine);
        setAdsr(0.003f, 0.28f, 0.05f, 0.22f);
        setFmParams(true, 3.6f, 9.0f, 0.002f, 0.18f, 0.00f, 0.12f);
        decayCurve.setExponential(-5.0f);
        releaseCurve.setExponential(-6.0f);
    }
    else if (presetName == "bright")
    {
        setOscType(OscType::Saw);
        setAdsr(0.01f, 0.08f, 0.42f, 0.18f);
    }
    else if (presetName == "pluck")
    {
        setOscType(OscType::Square);
        setAdsr(0.002f, 0.16f, 0.12f, 0.12f);
    }
    else if (presetName == "pad")
    {
        setOscType(OscType::Sine);
        setAdsr(0.18f, 0.25f, 0.70f, 0.90f);
    }
    else if (presetName == "bass")
    {
        setOscType(OscType::Square);
        setAdsr(0.01f, 0.16f, 0.55f, 0.18f);
        hasFilterSweep = true;
        filterCutoffStart = 640.0f;
        filterCutoffEnd = 80.0f;
        filterSweepDuration = 0.16f;
    }
    else if (presetName == "bell")
    {
        setOscType(OscType::Sine);
        setAdsr(0.002f, 0.70f, 0.05f, 1.20f);
        setFmParams(true, 1.5f, 12.0f, 0.002f, 0.45f, 0.00f, 0.40f);
    }
    else if (presetName == "glass")
    {
        setOscType(OscType::Triangle);
        setAdsr(0.004f, 0.45f, 0.24f, 0.55f);
    }
    else // warm / default
    {
        setOscType(OscType::Triangle);
        setAdsr(0.02f, 0.12f, 0.48f, 0.35f);
    }
}

void SynthVoice::triggerNoteOn(int noteId,
                               float pitchMidi,
                               float velocity,
                               float durationSeconds,
                               float targetPitchMidi,
                               float slideTimeSeconds,
                               float vibratoDepthCents,
                               float vibratoRateHz,
                               float tremoloDepth,
                               float tremoloRateHz,
                               float filterStartHz,
                               float filterEndHz,
                               float filterSweepTimeSeconds,
                               const musegrid::NoteExpression& expr)
{
    expression = expr;
    vibratoElapsed = 0.0f;
    tremoloElapsed = 0.0f;
    currentNoteId = noteId;
    startPitch = pitchMidi;
    currentPitch = pitchMidi;
    noteVelocity = juce::jlimit(0.0f, 1.0f, velocity);
    active = true;

    remainingDuration = durationSeconds > 0.0f ? durationSeconds : -1.0f;

    // Pitch slide / glide
    if (targetPitchMidi >= 0.0f && std::abs(targetPitchMidi - pitchMidi) > 0.001f)
    {
        targetPitch = targetPitchMidi;
        slideDuration = slideTimeSeconds > 0.0f ? slideTimeSeconds : durationSeconds;
        slideElapsed = 0.0f;
        isSliding = true;
    }
    else
    {
        isSliding = false;
    }

    // Vibrato / Tremolo
    vibDepth = vibratoDepthCents;
    vibRate = vibratoRateHz > 0.0f ? vibratoRateHz : 5.0f;
    tremDepth = tremoloDepth;
    tremRate = tremoloRateHz > 0.0f ? tremoloRateHz : 6.0f;

    // Filter sweep
    if (filterStartHz > 0.0f && filterEndHz > 0.0f)
    {
        hasFilterSweep = true;
        filterCutoffStart = filterStartHz;
        filterCutoffEnd = filterEndHz;
        filterSweepDuration = filterSweepTimeSeconds > 0.0f ? filterSweepTimeSeconds : durationSeconds;
        filterSweepElapsed = 0.0f;
        currentFilterCutoff = filterStartHz;
    }
    else
    {
        hasFilterSweep = false;
        currentFilterCutoff = 20000.0f;
    }

    // Start Attack
    envStage = EnvStage::Attack;
    envValue = 0.0f;
    stageElapsed = 0.0f;
}

void SynthVoice::triggerNoteOff()
{
    if (active && envStage != EnvStage::Off)
    {
        envStage = EnvStage::Release;
        stageElapsed = 0.0f;
        releaseStartLevel = envValue;
    }
}

void SynthVoice::stopImmediately()
{
    reset();
}

float SynthVoice::nextNoise()
{
    noiseSeed = (noiseSeed * 196314165 + 907633515);
    return ((float)(noiseSeed >> 16) / 32768.0f) - 1.0f;
}

float SynthVoice::sampleCurve(const std::array<float, musegrid::NoteExpression::kCurvePoints>& curve,
                              int count, float t)
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

float SynthVoice::waveform(int wave, double phase)
{
    switch (wave)
    {
        case 1:  return (float)(2.0 / juce::MathConstants<double>::pi * std::asin(std::sin(phase)));
        case 2:  return std::sin(phase) >= 0.0 ? 1.0f : -1.0f;
        default: return (float)std::sin(phase);
    }
}

void SynthVoice::renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol)
{
    if (!active || envStage == EnvStage::Off) return;

    const float sampleTime = 1.0f / (float)currentSampleRate;
    const float panAngle = (juce::jlimit(-1.0f, 1.0f, trackPan + expression.pan) + 1.0f) * 0.25f * juce::MathConstants<float>::pi;
    const float leftGain = std::cos(panAngle) * trackVol;
    const float rightGain = std::sin(panAngle) * trackVol;

    for (int i = 0; i < numSamples; ++i)
    {
        // 1. Advance Duration
        if (remainingDuration > 0.0f)
        {
            remainingDuration -= sampleTime;
            if (remainingDuration <= 0.0f)
            {
                triggerNoteOff();
            }
        }

        // 2. Pitch & Glide Interpolation
        if (isSliding && slideDuration > 0.0f)
        {
            slideElapsed += sampleTime;
            float t = juce::jlimit(0.0f, 1.0f, slideElapsed / slideDuration);
            const float shape = sampleCurve(expression.slideCurve, expression.slideCurveSize, t);
            float pitch = startPitch + (targetPitch - startPitch) * shape;
            if (expression.steppedGlide)
                pitch = std::round(pitch);
            currentPitch = pitch;
            if (t >= 1.0f) isSliding = false;
        }

        // 3. Vibrato Calculation
        float pitchOffset = 0.0f;
        vibratoElapsed += sampleTime;
        float activeVibDepth = vibDepth;
        if (activeVibDepth > 0.001f)
        {
            if (vibratoElapsed < expression.vibratoDelaySeconds)
            {
                activeVibDepth = 0.0f;
            }
            else if (expression.vibratoFadeSeconds > 0.0001f)
            {
                const float fadeProgress = (vibratoElapsed - expression.vibratoDelaySeconds)
                                         / expression.vibratoFadeSeconds;
                activeVibDepth *= juce::jlimit(0.0f, 1.0f, fadeProgress);
            }
        }
        if (activeVibDepth > 0.001f)
        {
            vibPhase += 2.0 * juce::MathConstants<double>::pi * vibRate * sampleTime;
            if (vibPhase > 2.0 * juce::MathConstants<double>::pi) vibPhase -= 2.0 * juce::MathConstants<double>::pi;
            pitchOffset = (activeVibDepth / 100.0f) * waveform(expression.vibratoWave, vibPhase);
        }

        // Convert MIDI to Frequency: f = 440 * 2^((midi - 69) / 12)
        const float effectivePitch = currentPitch + pitchOffset;
        const float freq = 440.0f * std::pow(2.0f, (effectivePitch - 69.0f) / 12.0f);
        const double phaseIncrement = (freq / currentSampleRate);

        // 4. Generate Raw Waveform
        float rawSample = 0.0f;
        if (isFM)
        {
            fmPhase += (phaseIncrement * fmHarmonicity);
            if (fmPhase >= 1.0) fmPhase -= 1.0;

            switch (envStage)
            {
                case EnvStage::Attack:
                    fmModEnvValue += sampleTime / fmModAttack;
                    if (fmModEnvValue >= 1.0f) fmModEnvValue = 1.0f;
                    break;
                case EnvStage::Decay:
                    fmModEnvValue -= (sampleTime / fmModDecay) * (1.0f - fmModSustain);
                    if (fmModEnvValue <= fmModSustain) fmModEnvValue = fmModSustain;
                    break;
                case EnvStage::Sustain:
                    fmModEnvValue = fmModSustain;
                    break;
                case EnvStage::Release:
                    fmModEnvValue -= (sampleTime / fmModRelease);
                    if (fmModEnvValue <= 0.0f) fmModEnvValue = 0.0f;
                    break;
                default:
                    fmModEnvValue = 0.0f;
                    break;
            }

            const double fmModulator = (fmModIndex * fmModEnvValue) * std::sin(fmPhase * 2.0 * juce::MathConstants<double>::pi);
            rawSample = (float)std::sin(currentPhase * 2.0 * juce::MathConstants<double>::pi + fmModulator);
        }
        else
        {
            switch (oscType)
            {
                case OscType::Sine:
                    rawSample = (float)std::sin(currentPhase * 2.0 * juce::MathConstants<double>::pi);
                    break;

                case OscType::Triangle:
                    rawSample = (float)(4.0 * std::abs(currentPhase - 0.5) - 1.0);
                    break;

                case OscType::Square:
                    rawSample = currentPhase < 0.5 ? 1.0f : -1.0f;
                    break;

                case OscType::Saw:
                    rawSample = (float)(2.0 * currentPhase - 1.0);
                    break;

                case OscType::Noise:
                    rawSample = nextNoise();
                    break;
            }
        }

        currentPhase += phaseIncrement;
        if (currentPhase >= 1.0) currentPhase -= 1.0;

        // 5. Filter Sweep
        if (hasFilterSweep && filterSweepDuration > 0.0f)
        {
            filterSweepElapsed += sampleTime;
            float t = juce::jlimit(0.0f, 1.0f, filterSweepElapsed / filterSweepDuration);
            const float shape = sampleCurve(expression.filterCurve, expression.filterCurveSize, t);
            currentFilterCutoff = filterCutoffStart + (filterCutoffEnd - filterCutoffStart) * shape;

            // Simple 1-pole Lowpass
            const float fc = juce::jlimit(20.0f, (float)(currentSampleRate * 0.45), currentFilterCutoff);
            const float coeff = 2.0f * juce::MathConstants<float>::pi * fc * sampleTime / (1.0f + 2.0f * juce::MathConstants<float>::pi * fc * sampleTime);
            filterState += coeff * (rawSample - filterState);
            rawSample = filterState;
        }

        // 6. ADSR Envelope Step
        switch (envStage)
        {
            case EnvStage::Attack:
                stageElapsed += sampleTime;
                if (attackTime > 0.0001f)
                {
                    float p = stageElapsed / attackTime;
                    if (p >= 1.0f)
                    {
                        envValue = 1.0f;
                        envStage = EnvStage::Decay;
                        stageElapsed = 0.0f;
                    }
                    else
                    {
                        envValue = p;
                    }
                }
                else
                {
                    envValue = 1.0f;
                    envStage = EnvStage::Decay;
                    stageElapsed = 0.0f;
                }
                break;

            case EnvStage::Decay:
                stageElapsed += sampleTime;
                if (decayTime > 0.0001f)
                {
                    float p = stageElapsed / decayTime;
                    if (p >= 1.0f)
                    {
                        envValue = sustainLevel;
                        envStage = EnvStage::Sustain;
                    }
                    else
                    {
                        float curveVal = decayCurve.sample(p); // 1.0 down to 0.0
                        envValue = sustainLevel + (1.0f - sustainLevel) * curveVal;
                    }
                }
                else
                {
                    envValue = sustainLevel;
                    envStage = EnvStage::Sustain;
                }
                break;

            case EnvStage::Sustain:
                envValue = sustainLevel;
                break;

            case EnvStage::Release:
                stageElapsed += sampleTime;
                if (releaseTime > 0.0001f)
                {
                    float p = stageElapsed / releaseTime;
                    if (p >= 1.0f)
                    {
                        envValue = 0.0f;
                        envStage = EnvStage::Off;
                        active = false;
                    }
                    else
                    {
                        float curveVal = releaseCurve.sample(p); // 1.0 down to 0.0
                        envValue = releaseStartLevel * curveVal;
                    }
                }
                else
                {
                    envValue = 0.0f;
                    envStage = EnvStage::Off;
                    active = false;
                }
                break;

            case EnvStage::Off:
                envValue = 0.0f;
                active = false;
                break;
        }

        // 7. Tremolo
        float tremMultiplier = 1.0f;
        tremoloElapsed += sampleTime;
        if (tremDepth > 0.001f)
        {
            tremPhase += 2.0 * juce::MathConstants<double>::pi * tremRate * sampleTime;
            if (tremPhase > 2.0 * juce::MathConstants<double>::pi) tremPhase -= 2.0 * juce::MathConstants<double>::pi;
            tremMultiplier = 1.0f - tremDepth * (float)(0.5 * (1.0 + waveform(expression.tremoloWave, tremPhase)));
        }

        // 8. Final Sample Output
        // Morph glides let both instruments sound and crossfade across the junction.
        float morphGain = 1.0f;
        if (expression.morphFadeInSeconds > 0.0001f)
            morphGain *= juce::jlimit(0.0f, 1.0f, vibratoElapsed / expression.morphFadeInSeconds);
        if (expression.morphFadeOutSeconds > 0.0001f)
            morphGain *= juce::jlimit(0.0f, 1.0f, 1.0f - vibratoElapsed / expression.morphFadeOutSeconds);

        const float finalVal = rawSample * envValue * noteVelocity * tremMultiplier
                               * morphGain * juce::jlimit(0.0f, 1.0f, expression.gain);
        leftOut[i] += finalVal * leftGain;
        rightOut[i] += finalVal * rightGain;

        if (!active) break;
    }
}
