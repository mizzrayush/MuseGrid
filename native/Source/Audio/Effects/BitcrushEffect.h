#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <cmath>

class BitcrushEffect
{
public:
    void prepare(double /*sampleRate*/, int /*samplesPerBlock*/)
    {
        reset();
    }

    void reset()
    {
        lp0 = 0.0f;
        lp1 = 0.0f;
    }

    void setDrive(float d) { drive = juce::jlimit(1.0f, 10.0f, d); }
    void setBits(float b)  { bits = juce::jlimit(2.0f, 16.0f, b); }
    void setDive(float d)  { dive = juce::jlimit(0.0f, 0.99f, d); }
    void setMix(float m)   { mix = juce::jlimit(0.0f, 1.0f, m); }

    void process(juce::AudioBuffer<float>& buffer)
    {
        if (mix <= 0.0001f) return;

        const int numChannels = buffer.getNumChannels();
        const int numSamples = buffer.getNumSamples();
        const float step = std::pow(0.5f, bits);
        const float cutoff = std::max(0.01f, 1.0f - dive);

        for (int ch = 0; ch < numChannels; ++ch)
        {
            float* channelData = buffer.getWritePointer(ch);
            float& lp = (ch == 0 ? lp0 : lp1);

            for (int i = 0; i < numSamples; ++i)
            {
                const float dry = channelData[i];
                
                // 1. Apply Drive & Hard Clip
                float x = dry * drive;
                x = juce::jlimit(-1.0f, 1.0f, x);

                // 2. Quantize amplitude (Bitcrushing)
                x = std::round(x / step) * step;

                // 3. Dive (1-pole lowpass filter)
                lp += cutoff * (x - lp);
                x = lp;

                // 4. Dry / Wet Mix
                channelData[i] = dry * (1.0f - mix) + x * mix;
            }
        }
    }

private:
    float drive = 1.5f;
    float bits = 8.0f;
    float dive = 0.5f;
    float mix = 0.0f; // Inactive unless enabled
    float lp0 = 0.0f;
    float lp1 = 0.0f;
};
