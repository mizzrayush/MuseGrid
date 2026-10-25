#pragma once
#include <juce_dsp/juce_dsp.h>

class PhaserEffect
{
public:
    PhaserEffect() = default;

    void prepare(double sampleRate, int blockSize)
    {
        currentSampleRate = sampleRate;
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)blockSize;
        spec.numChannels = 2;

        phaser.prepare(spec);
        phaser.setRate(0.5f);
        phaser.setDepth(0.8f);
        phaser.setCentreFrequency(350.0f);
        phaser.setFeedback(0.4f);
        phaser.setMix(0.0f); // Default bypassed (wet = 0)
    }

    void reset()
    {
        phaser.reset();
    }

    void setWet(float w)
    {
        wet = juce::jlimit(0.0f, 1.0f, w);
        phaser.setMix(wet);
    }

    void setRate(float r)
    {
        phaser.setRate(juce::jlimit(0.05f, 20.0f, r));
    }

    void setBaseFrequency(float f)
    {
        phaser.setCentreFrequency(juce::jlimit(50.0f, 5000.0f, f));
    }

    void process(juce::AudioBuffer<float>& buffer)
    {
        if (wet <= 0.001f) return;
        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> context(block);
        phaser.process(context);
    }

private:
    double currentSampleRate = 44100.0;
    float wet = 0.0f;
    juce::dsp::Phaser<float> phaser;
};
