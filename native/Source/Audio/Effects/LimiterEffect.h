#pragma once
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>

class LimiterEffect
{
public:
    void prepare(double sampleRate, int samplesPerBlock)
    {
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)samplesPerBlock;
        spec.numChannels = 2;

        limiter.prepare(spec);
        limiter.reset();
        limiter.setThreshold(-0.3f); // -0.3 dBFS ceiling
        limiter.setRelease(50.0f);   // 50ms smooth release
    }

    void reset()
    {
        limiter.reset();
    }

    void setCeiling(float ceilingDb)
    {
        limiter.setThreshold(juce::jlimit(-12.0f, 0.0f, ceilingDb));
    }

    void setRelease(float releaseMs)
    {
        limiter.setRelease(juce::jlimit(5.0f, 500.0f, releaseMs));
    }

    void process(juce::dsp::AudioBlock<float>& block)
    {
        juce::dsp::ProcessContextReplacing<float> context(block);
        limiter.process(context);
    }

private:
    juce::dsp::Limiter<float> limiter;
};
