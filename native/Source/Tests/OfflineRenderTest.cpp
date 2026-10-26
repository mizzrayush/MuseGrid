#include "OfflineRenderer.h"
#include <juce_gui_basics/juce_gui_basics.h>

namespace
{
    int failures = 0;

    void check(bool condition, const juce::String& label)
    {
        std::printf(condition ? "  PASS  %s\n" : "  FAIL  %s\n", label.toRawUTF8());
        if (!condition) ++failures;
    }

    juce::uint32 readU32(const juce::MemoryBlock& bytes, size_t offset)
    {
        const auto* p = static_cast<const juce::uint8*>(bytes.getData());
        return (juce::uint32)p[offset] | ((juce::uint32)p[offset + 1] << 8)
             | ((juce::uint32)p[offset + 2] << 16) | ((juce::uint32)p[offset + 3] << 24);
    }

    const char* kEventsJson = R"([
      {"type":"noteOn","trackId":"lead","instrument":"synth","pitch":60,"velocity":0.8,"duration":0.30,"time":0.00},
      {"type":"noteOn","trackId":"lead","instrument":"synth","pitch":64,"velocity":0.7,"duration":0.30,"time":0.25},
      {"type":"noteOn","trackId":"lead","instrument":"synth","pitch":67,"velocity":0.6,"duration":0.30,"time":0.50},
      {"type":"noteOn","trackId":"lead","instrument":"synth","pitch":72,"velocity":0.9,"duration":0.60,"time":0.75}
    ])";

    OfflineRenderer::RenderJob makeClickJob(const juce::File& file, double startTick)
    {
        OfflineRenderer::RenderJob job;
        job.outputFile = file;
        job.sampleRate = 44100.0;
        job.bitDepth = 16;
        job.totalDurationSeconds = 2.0;
        job.normalize = false;
        job.autoFade = false;

        auto& m = job.metronome;
        m.enabled = true;
        m.bpm = 120.0;
        m.startTick = startTick;
        m.beatsPerMeasure = 4;
        m.metronomeVolume = 1.0;
        m.gainDb = -6.0;
        m.pitchDecay = 0.01;
        m.octaves = 2.0;
        m.attack = 0.001;
        m.decay = 0.1;
        m.sustain = 0.0;
        m.release = 0.1;
        m.downbeatPitch = "C6";
        m.upbeatPitch = "C5";
        m.downbeatVel = 1.0;
        m.upbeatVel = 0.25;
        return job;
    }

    OfflineRenderer::RenderJob makeJob(const juce::File& file, int bitDepth, bool normalize, bool withOverrides = false)
    {
        OfflineRenderer::RenderJob job;
        job.outputFile = file;
        job.sampleRate = 44100.0;
        job.bitDepth = bitDepth;
        job.totalDurationSeconds = 2.0;
        job.normalize = normalize;
        job.normalizeTargetDb = -1.0;
        job.autoFade = true;
        job.fadeSeconds = 0.25;

        if (auto parsed = juce::JSON::parse(juce::String(kEventsJson)); parsed.isArray())
            job.events = *parsed.getArray();

        if (withOverrides)
        {
            juce::DynamicObject::Ptr overrideObj = new juce::DynamicObject();
            overrideObj->setProperty("trackId", "lead");
            overrideObj->setProperty("muted", true);
            job.trackOverrides.add(overrideObj.get());
        }

        return job;
    }

    struct ReadBack
    {
        double peak = 0.0;
        double lastSample = 0.0;
        int samples = 0;
        int bits = 0;
        int channels = 0;
        double rate = 0.0;
    };

    ReadBack inspect(const juce::File& file)
    {
        ReadBack out;
        juce::MemoryBlock bytes;
        if (!file.loadFileAsData(bytes)) return out;

        std::unique_ptr<juce::AudioFormatReader> reader(
            juce::WavAudioFormat().createReaderFor(new juce::MemoryInputStream(bytes, false), true));
        if (reader == nullptr) return out;

        out.bits = (int)reader->bitsPerSample;
        out.channels = (int)reader->numChannels;
        out.rate = reader->sampleRate;

        juce::AudioBuffer<float> buffer(out.channels, (int)reader->lengthInSamples);
        reader->read(&buffer, 0, (int)reader->lengthInSamples, 0, true, true);

        out.samples = (int)reader->lengthInSamples;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            const auto* data = buffer.getReadPointer(ch);
            for (int i = 0; i < buffer.getNumSamples(); ++i)
                out.peak = std::max(out.peak, (double)std::abs(data[i]));
        }
        if (buffer.getNumSamples() > 0)
            out.lastSample = std::abs(buffer.getReadPointer(0)[buffer.getNumSamples() - 1]);

        return out;
    }

    double peakInWindow(const juce::File& file, double fromSeconds, double toSeconds)
    {
        juce::MemoryBlock bytes;
        if (!file.loadFileAsData(bytes)) return 0.0;

        std::unique_ptr<juce::AudioFormatReader> reader(
            juce::WavAudioFormat().createReaderFor(new juce::MemoryInputStream(bytes, false), true));
        if (reader == nullptr) return 0.0;

        juce::AudioBuffer<float> buffer((int)reader->numChannels, (int)reader->lengthInSamples);
        reader->read(&buffer, 0, (int)reader->lengthInSamples, 0, true, true);

        const int start = juce::jlimit(0, buffer.getNumSamples(), (int)(fromSeconds * reader->sampleRate));
        const int end = juce::jlimit(start, buffer.getNumSamples(), (int)(toSeconds * reader->sampleRate));

        double peak = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            for (int i = start; i < end; ++i)
                peak = std::max(peak, (double)std::abs(buffer.getReadPointer(ch)[i]));
        return peak;
    }

    // --- drum expression ------------------------------------------------------
    // A hit is triggered through OfflineRenderer::dispatchNoteOn, the parser the live bridge and
    // the offline bounce share, so these checks cover the JSON wiring and the DSP in one go.
    juce::AudioBuffer<float> renderHit(const juce::String& eventJson, double seconds = 2.5)
    {
        AudioEngine engine;
        engine.prepareForRate(44100.0, 128);
        OfflineRenderer::dispatchNoteOn(engine, juce::JSON::parse(eventJson));

        const int total = (int)(seconds * 44100.0);
        juce::AudioBuffer<float> buffer(2, total);
        buffer.clear();
        for (int offset = 0; offset < total; offset += 512)
        {
            const int n = juce::jmin(512, total - offset);
            float* const ptrs[2] = { buffer.getWritePointer(0, offset), buffer.getWritePointer(1, offset) };
            engine.renderBlock(ptrs, 2, n);
        }
        return buffer;
    }

    juce::String drumEvent(double midiPitch, double durationSeconds, const juce::String& expression = {})
    {
        return "{\"type\":\"noteOn\",\"trackId\":\"drums\",\"instrument\":\"drum\",\"pitch\":"
             + juce::String((int)midiPitch) + ",\"velocity\":0.9,\"duration\":" + juce::String(durationSeconds)
             + (expression.isEmpty() ? juce::String() : "," + expression) + "}";
    }

    double peakInBuffer(const juce::AudioBuffer<float>& buffer, double fromSeconds, double toSeconds)
    {
        const int start = juce::jlimit(0, buffer.getNumSamples(), (int)(fromSeconds * 44100.0));
        const int end = juce::jlimit(start, buffer.getNumSamples(), (int)(toSeconds * 44100.0));
        double peak = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            for (int i = start; i < end; ++i)
                peak = std::max(peak, (double)std::abs(buffer.getReadPointer(ch)[i]));
        return peak;
    }

    /** FNV-1a over the raw sample bits: equal digests mean the two renders are bit-identical. */
    juce::uint32 digest(const juce::AudioBuffer<float>& buffer, double upToSeconds = -1.0)
    {
        const int limit = upToSeconds < 0.0
            ? buffer.getNumSamples()
            : juce::jlimit(0, buffer.getNumSamples(), (int)(upToSeconds * 44100.0));
        juce::uint32 hash = 2166136261u;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            const auto* data = buffer.getReadPointer(ch);
            for (int i = 0; i < limit; ++i)
            {
                const auto* bytes = reinterpret_cast<const juce::uint8*>(&data[i]);
                for (size_t b = 0; b < sizeof(float); ++b)
                {
                    hash ^= bytes[b];
                    hash *= 16777619u;
                }
            }
        }
        return hash;
    }
}

int main()
{
    juce::ScopedJuceInitialiser_GUI gui;

    AudioEngine engine;
    engine.prepareForRate(44100.0, 128);
    engine.addTrack("lead", "synth");
    engine.setTrackSynthPreset("lead", "piano");

    const auto dir = juce::File::getSpecialLocation(juce::File::tempDirectory);
    const auto wav24 = dir.getChildFile("musegrid_render_24.wav");
    const auto wav16 = dir.getChildFile("musegrid_render_16.wav");
    const auto muted = dir.getChildFile("musegrid_render_muted.wav");

    for (const auto& f : { wav24, wav16, muted })
        if (f.existsAsFile()) f.deleteFile();

    // --- 24-bit, normalised to -1 dBFS ---------------------------------------
    const auto job24 = makeJob(wav24, 24, true);
    const auto result24 = OfflineRenderer::renderToFile(job24, engine, 44100.0, 512);

    std::printf("\n== OfflineRenderer ==\n");
    check(result24.success, "24-bit render reported success");

    juce::MemoryBlock header;
    wav24.loadFileAsData(header);
    check(readU32(header, 0) == 0x46464952, "RIFF marker");            // "RIFF"
    check(readU32(header, 8) == 0x45564157, "WAVE marker");            // "WAVE"

    const auto peek24 = inspect(wav24);
    check(peek24.bits == 24, "file header declares 24-bit samples");
    check(peek24.channels == 2, "2 channels (stereo)");
    check(peek24.rate == 44100.0, "sample rate 44100");
    check(peek24.samples == (int)(2.0 * 44100.0), "file holds the full requested duration");
    check(wav24.getSize() >= (juce::int64)peek24.samples * peek24.channels * 3, "file size matches 24-bit interleaved data");
    check(peek24.peak > 0.05, "bounce is not silent");
    check(std::abs(peek24.peak - std::pow(10.0, -1.0 / 20.0)) < 0.01, "normalised peak within 1% of -1 dBFS");
    check(peek24.lastSample < 0.01, "auto-fade lands on silence");
    check(result24.appliedGain > 0.0, "normalisation gain was computed");

    // --- 16-bit, un-normalised ------------------------------------------------
    const auto job16 = makeJob(wav16, 16, false);
    const auto result16 = OfflineRenderer::renderToFile(job16, engine, 44100.0, 512);
    const auto peek16 = inspect(wav16);
    check(result16.success && peek16.bits == 16, "16-bit path writes 16-bit PCM");
    check(peek16.peak > 0.05, "16-bit bounce is not silent");
    check(result16.appliedGain == 1.0, "normalisation off leaves gain at 1.0");

    // --- track overrides ------------------------------------------------------
    const auto jobMuted = makeJob(muted, 16, false, true);
    const auto resultMuted = OfflineRenderer::renderToFile(jobMuted, engine, 44100.0, 512);
    const auto peekMuted = inspect(muted);
    check(resultMuted.success && peekMuted.peak < 1.0e-4, "mute override renders silence");

    // --- the live graph is usable again afterwards ------------------------------
    engine.playNote("lead", 60.0f, 0.8f, 0.25f, "synth");
    juce::AudioBuffer<float> live(2, 128);
    float* const livePtrs[2] = { live.getWritePointer(0), live.getWritePointer(1) };
    engine.renderBlock(livePtrs, 2, 128);
    double livePeak = 0.0;
    for (int ch = 0; ch < 2; ++ch)
        for (int i = 0; i < 128; ++i)
            livePeak = std::max(livePeak, (double)std::abs(live.getReadPointer(ch)[i]));
    check(livePeak > 0.01, "graph still renders after the bounce");

    // --- metronome click --------------------------------------------------------
    const auto clickOnly = dir.getChildFile("musegrid_render_click.wav");
    const auto clickOffset = dir.getChildFile("musegrid_render_click_offset.wav");
    for (const auto& f : { clickOnly, clickOffset })
        if (f.existsAsFile()) f.deleteFile();

    const auto clickResult = OfflineRenderer::renderToFile(makeClickJob(clickOnly, 0.0), engine, 44100.0, 512);
    check(clickResult.success, "metronome-only bounce renders with no note events");

    const double downbeatPeak = peakInWindow(clickOnly, 0.0, 0.08);
    const double upbeatPeak = peakInWindow(clickOnly, 0.5, 0.58);
    const double betweenPeaks = peakInWindow(clickOnly, 0.30, 0.45);
    check(downbeatPeak > 0.01, "downbeat click is audible");
    check(downbeatPeak > upbeatPeak * 2.5, "downbeat uses its configured velocity and accent");
    check(betweenPeaks < downbeatPeak * 0.05, "click decays between beats");

    const auto offsetResult = OfflineRenderer::renderToFile(makeClickJob(clickOffset, 192.0), engine, 44100.0, 512);
    const double offsetFirstPeak = peakInWindow(clickOffset, 0.0, 0.08);
    const double offsetDownbeatPeak = peakInWindow(clickOffset, 1.5, 1.58);
    check(offsetResult.success, "range starting mid-measure renders");
    check(offsetDownbeatPeak > offsetFirstPeak * 2.5,
          "click stays on the project beat grid instead of restarting at the range start");

    // --- drum expression --------------------------------------------------------
    std::printf("\n== Drum expression ==\n");
    {
        const auto hatBrief   = renderHit(drumEvent(42, 0.05));
        const auto hatNoLen   = renderHit(drumEvent(42, 0.0));
        const auto hatHeld    = renderHit(drumEvent(42, 1.0));
        const auto crashBrief = renderHit(drumEvent(49, 0.05));
        const auto crashNoLen = renderHit(drumEvent(49, 0.0));
        const auto kickBrief  = renderHit(drumEvent(36, 0.05));
        const auto kickNoLen  = renderHit(drumEvent(36, 0.0));
        const auto kickHeld   = renderHit(drumEvent(36, 0.6));
        const auto kickWob    = renderHit(drumEvent(36, 0.6, "\"vibratoDepth\":600,\"vibratoRate\":6"));
        const auto kickLong   = renderHit(drumEvent(36, 1.5));
        const auto kickGap    = renderHit(drumEvent(36, 1.5, "\"vibratoDepth\":600,\"vibratoRate\":6,\"vibratoDelay\":0.9"));
        const auto hatWob     = renderHit(drumEvent(42, 1.0, "\"vibratoDepth\":600,\"vibratoRate\":6"));
        const auto hatSweep   = renderHit(drumEvent(42, 1.0, "\"filterStart\":400,\"filterEnd\":14000"));

        // A lane-driven cutoff arrives as start/end plus the lane's own normalised shape, so the
        // shape has to be read as well as the two ends.
        juce::String laneShape = "\"filterStart\":400,\"filterEnd\":14000,\"filterCurve\":[";
        for (int i = 0; i < musegrid::NoteExpression::kCurvePoints; ++i)
        {
            const double wobble = 0.5 * (1.0 - std::cos(2.0 * juce::MathConstants<double>::pi * (double)i / 32.0));
            laneShape += juce::String(wobble, 6) + (i + 1 == musegrid::NoteExpression::kCurvePoints ? "]" : ",");
        }
        const auto hatLane  = renderHit(drumEvent(42, 1.0, laneShape));
        const auto hatDecay = renderHit(drumEvent(42, 0.05, "\"drumDecay\":0.9"));
        const auto kickSlide = renderHit(drumEvent(36, 0.6, "\"slideSemitones\":-12"));
        const auto hatQuiet = renderHit(drumEvent(42, 1.0, "\"gain\":0.5"));

        check(digest(hatBrief) == digest(hatNoLen), "a note shorter than the kit decay leaves a hat bit-identical");
        check(digest(kickBrief) == digest(kickNoLen), "a note shorter than the kit decay leaves a kick bit-identical");
        check(digest(crashBrief) == digest(crashNoLen), "note length never truncates the crash's own decay");
        check(peakInBuffer(crashNoLen, 0.8, 1.2) > 1.0e-4, "a 0.05 s note still rings the crash out");
        check(peakInBuffer(hatBrief, 0.30, 0.60) < 1.0e-5, "an unheld closed hat is silent past its decay");
        check(peakInBuffer(hatHeld, 0.30, 0.60) > 1.0e-3, "a 1 s note holds the closed hat on");
        check(peakInBuffer(hatDecay, 0.30, 0.60) > 1.0e-3, "the pad decay slider still sets the hit length");
        check(digest(kickWob) != digest(kickHeld), "pitch wobble changes a tonal pad");
        check(std::abs(peakInBuffer(kickWob, 0.0, 0.6) - peakInBuffer(kickHeld, 0.0, 0.6)) < 0.02,
              "wobble moves pitch, not level");
        check(digest(kickGap, 0.85) == digest(kickLong, 0.85), "vibrato delay keeps the wobble off the attack");
        check(digest(kickGap, 1.45) != digest(kickLong, 1.45), "and the wobble arrives once the delay has passed");
        check(digest(hatWob) != digest(hatHeld), "the same wobble rides the cutoff on a filtered pad");
        check(digest(hatSweep) != digest(hatHeld), "a tone sweep moves the filter across the hit");
        check(digest(hatLane) != digest(hatSweep), "the lane's curve shape is followed, not only its ends");
        check(digest(kickSlide) != digest(kickHeld), "per-note slide still bends the hit");
        // Measured in the tail, well under the master limiter's ceiling: the attack transient of a
        // held hat is loud enough for the limiter to make the chain non-linear.
        const double quietTail = peakInBuffer(hatQuiet, 0.30, 0.60);
        const double heldTail = peakInBuffer(hatHeld, 0.30, 0.60);
        check(std::abs(quietTail / heldTail - 0.5) < 0.01, "per-note gain automation still scales the hit");

        std::printf("  digests  hat-brief=%08X hat-held=%08X kick-wobble=%08X hat-sweep=%08X hat-lane=%08X\n",
                    (unsigned)digest(hatBrief), (unsigned)digest(hatHeld), (unsigned)digest(kickWob),
                    (unsigned)digest(hatSweep), (unsigned)digest(hatLane));
        std::printf("  tail peak  gain-half=%.6f of held=%.6f\n", quietTail, heldTail);
    }

    wav24.deleteFile();
    wav16.deleteFile();
    muted.deleteFile();
    clickOnly.deleteFile();
    clickOffset.deleteFile();

    std::printf("\n%s (%d failure%s)\n", failures == 0 ? "ALL CHECKS PASSED" : "CHECKS FAILED",
                failures, failures == 1 ? "" : "s");
    return failures == 0 ? 0 : 1;
}
