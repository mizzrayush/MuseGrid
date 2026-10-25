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
        juce::dsp::ProcessSpec spec;
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32)samplesPerBlock;
        spec.numChannels = 2;

        reverb.prepare(spec);
        reverb.reset();
        updateParameters();
    }

    void reset()
    {
        reverb.reset();
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

    void process(juce::dsp::AudioBlock<float>& block)
    {
        if (wet <= 0.001f) return;

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
    float roomSize = 0.5f;
    float damping = 0.5f;
    float wet = 0.0f;
    float width = 1.0f;
};
