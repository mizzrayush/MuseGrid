#pragma once
#include <juce_core/juce_core.h>
#include <vector>
#include <cmath>

class PhysicalModelVoice
{
public:
    PhysicalModelVoice();

    void prepare(double sampleRate);
    void reset();

    void triggerPluck(int noteId,
                      float pitchMidi,
                      float velocity,
                      float durationSeconds,
                      float damping = 0.5f,
                      float pluckPosition = 0.5f,
                      float stiffness = 0.0f);

    void triggerNoteOff();
    void stopImmediately();

    bool isActive() const { return active; }
    int getNoteId() const { return currentNoteId; }

    void renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol);

private:
    double currentSampleRate = 44100.0;
    bool active = false;
    int currentNoteId = -1;

    // Delay line
    std::vector<float> delayBuffer;
    int bufferSize = 0;
    int writeIndex = 0;
    float delayLengthSamples = 100.0f;

    // Filter states
    float lastFilterSample = 0.0f;
    float loopGain = 0.995f;
    float dampingFactor = 0.5f;

    float remainingSeconds = 0.0f;
    float noteVelocity = 1.0f;
    juce::uint32 noiseSeed = 998877;
    float nextNoise();
};
