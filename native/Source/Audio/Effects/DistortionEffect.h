#pragma once
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <cmath>

class DistortionEffect
{
public:
    enum class Mode { SoftClipping, HardClipping, Tanh, Fuzz };

    void prepare(double /*sampleRate*/, int /*samplesPerBlock*/)
    {
    }

    void reset() {}

    void setDrive(float driveAmount) // 0.0 to 1.0
    {
        drive = juce::jlimit(0.0f, 1.0f, driveAmount);
        gain = 1.0f + drive * 9.0f; // 1x to 10x pre-gain
    }

    void setMix(float mixAmount) // 0.0 to 1.0
    {
        mix = juce::jlimit(0.0f, 1.0f, mixAmount);
    }

    void setMode(Mode newMode)
    {
        mode = newMode;
    }

    void process(juce::dsp::AudioBlock<float>& block)
    {
        if (drive <= 0.001f || mix <= 0.001f) return;

        const size_t numChannels = block.getNumChannels();
        const size_t numSamples = block.getNumSamples();

        for (size_t ch = 0; ch < numChannels; ++ch)
        {
            float* channelData = block.getChannelPointer(ch);

            for (size_t i = 0; i < numSamples; ++i)
            {
                const float dry = channelData[i];
                float x = dry * gain;
                float wet = 0.0f;

                switch (mode)
                {
                    case Mode::SoftClipping:
                        // Cubic soft clipper
                        if (x > 1.0f) wet = 2.0f / 3.0f;
                        else if (x < -1.0f) wet = -2.0f / 3.0f;
                        else wet = x - (x * x * x) / 3.0f;
                        break;

                    case Mode::HardClipping:
                        wet = juce::jlimit(-1.0f, 1.0f, x);
                        break;

                    case Mode::Tanh:
                        wet = std::tanh(x);
                        break;

                    case Mode::Fuzz:
                        wet = (x > 0.0f) ? (1.0f - std::exp(-x)) : (-1.0f + std::exp(x));
                        break;
                }

                channelData[i] = (1.0f - mix) * dry + mix * (wet / (1.0f + drive * 0.5f));
            }
        }
    }

private:
    float drive = 0.0f;
    float gain = 1.0f;
    float mix = 1.0f;
    Mode mode = Mode::Tanh;
};
