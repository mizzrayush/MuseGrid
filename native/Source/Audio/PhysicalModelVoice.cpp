#include "PhysicalModelVoice.h"

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
                                     float /*stiffness*/)
{
    currentNoteId = noteId;
    noteVelocity = juce::jlimit(0.0f, 1.0f, velocity);
    active = true;
    remainingSeconds = durationSeconds > 0.0f ? durationSeconds : 1.0f;

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
    const float panAngle = (trackPan + 1.0f) * 0.25f * juce::MathConstants<float>::pi;
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

        const float outVal = filtered;
        leftOut[i] += outVal * leftGain;
        rightOut[i] += outVal * rightGain;
    }
}
