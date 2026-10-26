#pragma once
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <vector>
#include <cmath>

class ReverbEffect
{
public:
    void prepare(double sampleRate, int samplesPerBlock)
    {
        currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)samplesPerBlock;
        spec.numChannels = 2;

        reverb.prepare(spec);
        reverb.reset();
        preDelay.prepare(spec);
        preDelay.setMaximumDelayInSamples((int)std::ceil(sampleRate * 1.0));
        preDelay.reset();
        preDelaySamples = juce::jlimit(0, (int)(sampleRate * 1.0), (int)(preDelaySeconds * sampleRate));
        preDelay.setDelay((float)preDelaySamples);
        updateParameters();
    }

    void reset()
    {
        reverb.reset();
        preDelay.reset();
    }

    void setRoomSize(float size) // 0.0 to 1.0
    {
        roomSize = juce::jlimit(0.0f, 1.0f, size);
        updateParameters();
    }

    void setDamping(float damp) // 0.0 to 1.0
    {
        damping = juce::jlimit(0.0f, 1.0f, damp);
        updateParameters();
    }

    void setWet(float wetLevel) // 0.0 to 1.0
    {
        wet = juce::jlimit(0.0f, 1.0f, wetLevel);
        updateParameters();
    }

    void setWidth(float w) // 0.0 to 1.0
    {
        width = juce::jlimit(0.0f, 1.0f, w);
        updateParameters();
    }

    void setPreDelay(float seconds)
    {
        preDelaySeconds = juce::jlimit(0.0f, 1.0f, seconds);
        preDelaySamples = (int)(preDelaySeconds * currentSampleRate);
        preDelay.setDelay((float)preDelaySamples);
    }

    void process(juce::dsp::AudioBlock<float>& block)
    {
        if (wet <= 0.001f) return;

        if (preDelaySamples > 0)
        {
            const int numChannels = juce::jmin(2, (int)block.getNumChannels());
            const int numSamples = (int)block.getNumSamples();
            for (int s = 0; s < numSamples; ++s)
            {
                for (int ch = 0; ch < numChannels; ++ch)
                {
                    auto* data = block.getChannelPointer((size_t)ch);
                    preDelay.pushSample(ch, data[s]);
                    data[s] = preDelay.popSample(ch);
                }
            }
        }

        juce::dsp::ProcessContextReplacing<float> context(block);
        reverb.process(context);
    }

private:
    void updateParameters()
    {
        juce::dsp::Reverb::Parameters params;
        params.roomSize = roomSize;
        params.damping = damping;
        params.wetLevel = wet;
        params.dryLevel = 1.0f - wet;
        params.width = width;
        params.freezeMode = 0.0f;
        reverb.setParameters(params);
    }

    juce::dsp::Reverb reverb;
    juce::dsp::DelayLine<float, juce::dsp::DelayLineInterpolationTypes::Linear> preDelay;
    double currentSampleRate = 44100.0;
    int preDelaySamples = 0;
    float preDelaySeconds = 0.0f;
    float roomSize = 0.5f;
    float damping = 0.5f;
    float wet = 0.0f;
    float width = 1.0f;
};
