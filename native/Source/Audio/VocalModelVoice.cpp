#include "VocalModelVoice.h"

VocalModelVoice::VocalModelVoice()
{
}

void VocalModelVoice::prepare(double sampleRate)
{
    currentSampleRate = sampleRate;
    reset();
}

void VocalModelVoice::reset()
{
    active = false;
    currentNoteId = -1;
    phase = 0.0;
    vibPhase = 0.0;
    remainingSeconds = 0.0f;
    for (int i = 0; i < NUM_FORMANTS; ++i)
    {
        formants[i].y1 = 0.0f;
        formants[i].y2 = 0.0f;
    }
}

float VocalModelVoice::nextNoise()
{
    noiseSeed = (noiseSeed * 196314165 + 907633515);
    return ((float)(noiseSeed >> 16) / 32768.0f) - 1.0f;
}

void VocalModelVoice::setVowelFormants(const juce::String& vowel)
{
    auto v = vowel.toLowerCase().trim();

    // Standard Peterson & Barney formant frequencies (Hz) for adult vocal tract
    if (v == "i" || v == "ee")
    {
        formants[0] = { 270.0f,  4.0f, 1.0f,  0.0f, 0.0f };
        formants[1] = { 2290.0f, 8.0f, 0.4f,  0.0f, 0.0f };
        formants[2] = { 3010.0f, 9.0f, 0.2f,  0.0f, 0.0f };
        formants[3] = { 3500.0f, 10.0f, 0.1f, 0.0f, 0.0f };
        formants[4] = { 4500.0f, 10.0f, 0.05f,0.0f, 0.0f };
    }
    else if (v == "e" || v == "eh")
    {
        formants[0] = { 530.0f,  5.0f, 1.0f,  0.0f, 0.0f };
        formants[1] = { 1840.0f, 7.0f, 0.5f,  0.0f, 0.0f };
        formants[2] = { 2480.0f, 8.0f, 0.25f, 0.0f, 0.0f };
        formants[3] = { 3500.0f, 10.0f, 0.1f, 0.0f, 0.0f };
        formants[4] = { 4500.0f, 10.0f, 0.05f,0.0f, 0.0f };
    }
    else if (v == "o" || v == "oh")
    {
        formants[0] = { 500.0f,  5.0f, 1.0f,  0.0f, 0.0f };
        formants[1] = { 700.0f,  5.0f, 0.7f,  0.0f, 0.0f };
        formants[2] = { 2410.0f, 8.0f, 0.15f, 0.0f, 0.0f };
        formants[3] = { 3500.0f, 10.0f, 0.1f, 0.0f, 0.0f };
        formants[4] = { 4500.0f, 10.0f, 0.05f,0.0f, 0.0f };
    }
    else if (v == "u" || v == "oo")
    {
        formants[0] = { 300.0f,  4.0f, 1.0f,  0.0f, 0.0f };
        formants[1] = { 870.0f,  6.0f, 0.35f, 0.0f, 0.0f };
        formants[2] = { 2240.0f, 8.0f, 0.1f,  0.0f, 0.0f };
        formants[3] = { 3500.0f, 10.0f, 0.08f,0.0f, 0.0f };
        formants[4] = { 4500.0f, 10.0f, 0.05f,0.0f, 0.0f };
    }
    else // Default "a" / "ah"
    {
        formants[0] = { 730.0f,  6.0f, 1.0f,  0.0f, 0.0f };
        formants[1] = { 1090.0f, 6.0f, 0.6f,  0.0f, 0.0f };
        formants[2] = { 2440.0f, 8.0f, 0.2f,  0.0f, 0.0f };
        formants[3] = { 3500.0f, 10.0f, 0.1f, 0.0f, 0.0f };
        formants[4] = { 4500.0f, 10.0f, 0.05f,0.0f, 0.0f };
    }

    // Apply vocal tract scaling
    for (int i = 0; i < NUM_FORMANTS; ++i)
    {
        formants[i].freq = juce::jlimit(100.0f, (float)(currentSampleRate * 0.45), formants[i].freq / tractScale);
    }
}

void VocalModelVoice::triggerVocal(int noteId,
                                  float pitchMidi,
                                  float velocity,
                                  float durationSeconds,
                                  const juce::String& vowel,
                                  float tractLength,
                                  float breathiness,
                                  float glottalTension,
                                  float vibratoDepth,
                                  float vibratoRate)
{
    currentNoteId = noteId;
    basePitch = pitchMidi;
    noteVelocity = juce::jlimit(0.0f, 1.0f, velocity);
    active = true;
    remainingSeconds = durationSeconds > 0.0f ? durationSeconds : 1.0f;

    tractScale = juce::jlimit(0.6f, 1.6f, tractLength);
    breathLevel = juce::jlimit(0.0f, 1.0f, breathiness);
    tension = juce::jlimit(0.1f, 1.0f, glottalTension);
    vibDepth = vibratoDepth;
    vibRate = vibratoRate > 0.0f ? vibratoRate : 5.5f;

    phase = 0.0;
    vibPhase = 0.0;
    setVowelFormants(vowel);
}

void VocalModelVoice::triggerNoteOff()
{
    remainingSeconds = 0.05f; // Fast release
}

void VocalModelVoice::stopImmediately()
{
    reset();
}

void VocalModelVoice::FormantFilter::processBiquad(float in, float& out, double sampleRate)
{
    // Resonant bandpass filter using 2-pole resonator
    const float w0 = 2.0f * juce::MathConstants<float>::pi * (freq / (float)sampleRate);
    const float alpha = std::sin(w0) / (2.0f * q);
    const float b0 = alpha;
    const float a0 = 1.0f + alpha;
    const float a1 = -2.0f * std::cos(w0);
    const float a2 = 1.0f - alpha;

    const float normIn = in * gain;
    const float y0 = (b0 * normIn - a1 * y1 - a2 * y2) / a0;
    y2 = y1;
    y1 = y0;
    out += y0;
}

void VocalModelVoice::renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol)
{
    if (!active) return;

    const float sampleTime = 1.0f / (float)currentSampleRate;
    const float panAngle = (trackPan + 1.0f) * 0.25f * juce::MathConstants<float>::pi;
    const float leftGain = std::cos(panAngle) * trackVol;
    const float rightGain = std::sin(panAngle) * trackVol;

    for (int i = 0; i < numSamples; ++i)
    {
        remainingSeconds -= sampleTime;
        if (remainingSeconds <= 0.0f)
        {
            active = false;
            break;
        }

        // Vibrato
        float pitchOffset = 0.0f;
        if (vibDepth > 0.01f)
        {
            vibPhase += 2.0 * juce::MathConstants<double>::pi * vibRate * sampleTime;
            if (vibPhase > 2.0 * juce::MathConstants<double>::pi) vibPhase -= 2.0 * juce::MathConstants<double>::pi;
            pitchOffset = (vibDepth / 100.0f) * (float)std::sin(vibPhase);
        }

        const float freq = 440.0f * std::pow(2.0f, (basePitch + pitchOffset - 69.0f) / 12.0f);
        phase += (freq / currentSampleRate);
        if (phase >= 1.0) phase -= 1.0;

        // Glottal source excitation (LF-model approximation)
        float glottal = 0.0f;
        if (phase < tension)
        {
            // Glottal opening phase (skewed half-sine)
            glottal = (float)std::sin((phase / tension) * juce::MathConstants<double>::pi);
        }
        else
        {
            // Glottal closure (snappy return)
            float tRel = (float)(phase - tension) / (1.0f - tension);
            glottal = -std::exp(-tRel * 10.0f) * 0.4f;
        }

        // Add aspiration noise (breathiness)
        glottal = (1.0f - breathLevel) * glottal + breathLevel * nextNoise();

        // Pass through formant filter bank
        float vocalOut = 0.0f;
        for (int f = 0; f < NUM_FORMANTS; ++f)
        {
            formants[f].processBiquad(glottal, vocalOut, currentSampleRate);
        }

        const float finalVal = vocalOut * noteVelocity * 0.8f;
        leftOut[i] += finalVal * leftGain;
        rightOut[i] += finalVal * rightGain;
    }
}
