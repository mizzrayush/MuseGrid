#pragma once
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <vector>

class DelayEffect
{
public:
    void prepare(double sampleRate, int /*samplesPerBlock*/)
    {
        currentSampleRate = sampleRate;
        maxDelaySamples = (int)(sampleRate * 4.0); // 4 seconds max buffer
        bufferL.assign(maxDelaySamples, 0.0f);
        bufferR.assign(maxDelaySamples, 0.0f);
        writeIndex = 0;
        filterStateL = 0.0f;
        filterStateR = 0.0f;
    }

    void reset()
    {
        std::fill(bufferL.begin(), bufferL.end(), 0.0f);
        std::fill(bufferR.begin(), bufferR.end(), 0.0f);
        writeIndex = 0;
        filterStateL = 0.0f;
        filterStateR = 0.0f;
    }

    void setTime(float seconds)
    {
        delayTimeSeconds = juce::jlimit(0.001f, 3.5f, seconds);
    }

    void setFeedback(float fb)
    {
        feedback = juce::jlimit(0.0f, 0.95f, fb);
    }

    void setWet(float wetLevel)
    {
        wet = juce::jlimit(0.0f, 1.0f, wetLevel);
    }

    void setDamping(float damp)
    {
        damping = juce::jlimit(0.0f, 0.99f, damp);
    }

    void setPingPong(bool isPingPong)
    {
        pingPong = isPingPong;
    }

    void process(juce::dsp::AudioBlock<float>& block)
    {
        if (wet <= 0.001f || bufferL.empty()) return;

        const size_t numSamples = block.getNumSamples();
        const int delaySamples = juce::jlimit(1, maxDelaySamples - 1, (int)(delayTimeSeconds * currentSampleRate));

        float* channelL = block.getChannelPointer(0);
        float* channelR = block.getNumChannels() > 1 ? block.getChannelPointer(1) : channelL;

        const float filterCoeff = 1.0f - damping;

        for (size_t i = 0; i < numSamples; ++i)
        {
            const float inL = channelL[i];
            const float inR = channelR[i];

            int readIndexL = (writeIndex - delaySamples + maxDelaySamples) % maxDelaySamples;
            int readIndexR = pingPong 
                ? (writeIndex - (delaySamples / 2) + maxDelaySamples) % maxDelaySamples 
                : readIndexL;

            float delayedL = bufferL[readIndexL];
            float delayedR = bufferR[readIndexR];

            // 1-pole damping filter in feedback loop
            filterStateL += filterCoeff * (delayedL - filterStateL);
            filterStateR += filterCoeff * (delayedR - filterStateR);

            if (pingPong)
            {
                bufferL[writeIndex] = inL + filterStateR * feedback;
                bufferR[writeIndex] = inR + filterStateL * feedback;
            }
            else
            {
                bufferL[writeIndex] = inL + filterStateL * feedback;
                bufferR[writeIndex] = inR + filterStateR * feedback;
            }

            channelL[i] = inL * (1.0f - wet) + delayedL * wet;
            channelR[i] = inR * (1.0f - wet) + delayedR * wet;

            writeIndex = (writeIndex + 1) % maxDelaySamples;
        }
    }

private:
    double currentSampleRate = 44100.0;
    int maxDelaySamples = 44100 * 4;
    std::vector<float> bufferL;
    std::vector<float> bufferR;
    int writeIndex = 0;

    float delayTimeSeconds = 0.25f;
    float feedback = 0.3f;
    float wet = 0.0f;
    float damping = 0.2f;
    bool pingPong = false;

    float filterStateL = 0.0f;
    float filterStateR = 0.0f;
};
