#pragma once
#include <juce_dsp/juce_dsp.h>

class ChorusEffect
{
public:
    ChorusEffect() = default;

    void prepare(double sampleRate, int blockSize)
    {
        currentSampleRate = sampleRate;
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)blockSize;
        spec.numChannels = 2;

        chorus.prepare(spec);
        chorus.setRate(1.5f);
        chorus.setDepth(0.7f);
        chorus.setCentreDelay(3.5f);
        chorus.setFeedback(0.2f);
        chorus.setMix(0.0f); // Default bypassed (wet = 0)
    }

    void reset()
    {
        chorus.reset();
    }

    void setWet(float w)
    {
        wet = juce::jlimit(0.0f, 1.0f, w);
        chorus.setMix(wet);
    }

    void setRate(float r)
    {
        chorus.setRate(juce::jlimit(0.05f, 20.0f, r));
    }

    void setDepth(float d)
    {
        chorus.setDepth(juce::jlimit(0.0f, 1.0f, d));
    }

    void setDelayTime(float delayMs)
    {
        chorus.setCentreDelay(juce::jlimit(0.5f, 20.0f, delayMs));
    }

    void process(juce::AudioBuffer<float>& buffer)
    {
        if (wet <= 0.001f) return;
        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> context(block);
        chorus.process(context);
    }

private:
    double currentSampleRate = 44100.0;
    float wet = 0.0f;
    juce::dsp::Chorus<float> chorus;
};
