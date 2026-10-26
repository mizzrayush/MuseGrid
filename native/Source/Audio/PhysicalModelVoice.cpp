#include "PhysicalModelVoice.h"

namespace
{
    float sampleSlideCurve(const std::array<float, musegrid::NoteExpression::kCurvePoints>& curve,
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
}

PhysicalModelVoice::PhysicalModelVoice()
{
}

void PhysicalModelVoice::prepare(double sampleRate)
{
    currentSampleRate = sampleRate;
    // Buffer for lowest note (e.g. MIDI 20 = 16.35 Hz -> 44100 / 16.35 ~ 2700 samples)
    bufferSize = (int)(sampleRate / 15.0) + 10;
    delayBuffer.assign(bufferSize, 0.0f);
    reset();
}

void PhysicalModelVoice::reset()
{
    active = false;
    currentNoteId = -1;
    writeIndex = 0;
    lastFilterSample = 0.0f;
    remainingSeconds = 0.0f;
    expression = {};
    isSliding = false;
    slideElapsed = 0.0f;
    elapsedSeconds = 0.0f;
    std::fill(delayBuffer.begin(), delayBuffer.end(), 0.0f);
}

float PhysicalModelVoice::nextNoise()
{
    noiseSeed = (noiseSeed * 196314165 + 907633515);
    return ((float)(noiseSeed >> 16) / 32768.0f) - 1.0f;
}

void PhysicalModelVoice::triggerPluck(int noteId,
                                     float pitchMidi,
                                     float velocity,
                                     float durationSeconds,
                                     float damping,
                                     float pluckPosition,
                                     float /*stiffness*/,
                                     const musegrid::NoteExpression& expr,
                                     float targetPitchMidi,
                                     float slideTimeSeconds)
{
    currentNoteId = noteId;
    noteVelocity = juce::jlimit(0.0f, 1.0f, velocity);
    active = true;
    remainingSeconds = durationSeconds > 0.0f ? durationSeconds : 1.0f;

    expression = expr;
    elapsedSeconds = 0.0f;
    basePitch = pitchMidi;

    if (targetPitchMidi >= 0.0f && std::abs(targetPitchMidi - pitchMidi) > 0.001f)
    {
        targetPitch = targetPitchMidi;
        slideDuration = slideTimeSeconds > 0.0f ? slideTimeSeconds : remainingSeconds;
        slideElapsed = 0.0f;
        isSliding = true;
    }
    else
    {
        targetPitch = pitchMidi;
        slideDuration = 0.0f;
        slideElapsed = 0.0f;
        isSliding = false;
    }

    const float freq = 440.0f * std::pow(2.0f, (pitchMidi - 69.0f) / 12.0f);
    delayLengthSamples = (float)(currentSampleRate / freq);
    delayLengthSamples = juce::jlimit(2.0f, (float)(bufferSize - 2), delayLengthSamples);

    const int delayInt = (int)delayLengthSamples;
    dampingFactor = juce::jlimit(0.05f, 0.95f, damping);
    loopGain = 0.996f - (0.005f * (1.0f - dampingFactor));

    // Fill delay line with initial pluck noise burst
    writeIndex = 0;
    lastFilterSample = 0.0f;
    std::fill(delayBuffer.begin(), delayBuffer.end(), 0.0f);

    const int combDip = juce::jlimit(1, delayInt - 1, (int)(delayInt * pluckPosition));

    for (int i = 0; i < delayInt; ++i)
    {
        float noise = nextNoise();
        // Comb filtering for pluck pick position
        if (i >= combDip) noise -= delayBuffer[i - combDip];
        delayBuffer[i] = noise * noteVelocity;
    }
}

void PhysicalModelVoice::triggerNoteOff()
{
    // Fast damping release
    loopGain = 0.90f;
}

void PhysicalModelVoice::stopImmediately()
{
    reset();
}

void PhysicalModelVoice::renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol)
{
    if (!active || delayBuffer.empty()) return;

    const float sampleTime = 1.0f / (float)currentSampleRate;
    const float panAngle = (juce::jlimit(-1.0f, 1.0f, trackPan + expression.pan) + 1.0f) * 0.25f * juce::MathConstants<float>::pi;
    const float leftGain = std::cos(panAngle) * trackVol;
    const float rightGain = std::sin(panAngle) * trackVol;

    for (int i = 0; i < numSamples; ++i)
    {
        remainingSeconds -= sampleTime;
        if (remainingSeconds <= 0.0f)
        {
            loopGain *= 0.999f;
            if (loopGain < 0.01f)
            {
                active = false;
                break;
            }
        }

        elapsedSeconds += sampleTime;

        // Glide by retuning the string's delay length, the physical equivalent of bending pitch.
        if (isSliding && slideDuration > 0.0f)
        {
            slideElapsed += sampleTime;
            const float t = juce::jlimit(0.0f, 1.0f, slideElapsed / slideDuration);
            const float shape = sampleSlideCurve(expression.slideCurve, expression.slideCurveSize, t);
            float pitch = basePitch + (targetPitch - basePitch) * shape;
            if (expression.steppedGlide)
                pitch = std::round(pitch);
            const float freq = 440.0f * std::pow(2.0f, (pitch - 69.0f) / 12.0f);
            delayLengthSamples = juce::jlimit(2.0f, (float)(bufferSize - 2), (float)(currentSampleRate / freq));
            if (t >= 1.0f) isSliding = false;
        }

        // Fractional delay line reading with linear interpolation
        float readPos = (float)writeIndex - delayLengthSamples;
        while (readPos < 0.0f) readPos += (float)bufferSize;
        while (readPos >= (float)bufferSize) readPos -= (float)bufferSize;

        const int i0 = (int)readPos;
        const int i1 = (i0 + 1) % bufferSize;
        const float frac = readPos - (float)i0;
        const float delayedSample = delayBuffer[i0] + frac * (delayBuffer[i1] - delayBuffer[i0]);

        // Karplus-Strong lowpass averaging filter: y[n] = (x[n] + x[n-1]) / 2
        const float filtered = (delayedSample * (1.0f - dampingFactor) + lastFilterSample * dampingFactor);
        lastFilterSample = delayedSample;

        // Feedback write
        delayBuffer[writeIndex] = filtered * loopGain;
        writeIndex = (writeIndex + 1) % bufferSize;

        float morphGain = 1.0f;
        if (expression.morphFadeInSeconds > 0.0001f)
            morphGain *= juce::jlimit(0.0f, 1.0f, elapsedSeconds / expression.morphFadeInSeconds);
        if (expression.morphFadeOutSeconds > 0.0001f)
            morphGain *= juce::jlimit(0.0f, 1.0f, 1.0f - elapsedSeconds / expression.morphFadeOutSeconds);

        const float outVal = filtered * morphGain * juce::jlimit(0.0f, 1.0f, expression.gain);
        leftOut[i] += outVal * leftGain;
        rightOut[i] += outVal * rightGain;
    }
}
