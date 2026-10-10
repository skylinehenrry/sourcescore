import Foundation
import AVFoundation
import AudioToolbox
final class AudioRack:@unchecked Sendable {
    let queue=DispatchQueue(label:"SourceScore.audio",qos:.userInteractive)
    let engine=AVAudioEngine();var samplers:[String:AVAudioUnitSampler]=[:],programs:[String:Int]=[:]
    var bank=URL(fileURLWithPath:"/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
    var timer:DispatchSourceTimer?,generation=0
    var outputError:((String)->Void)?
    func sampler(_ part:Part)throws->AVAudioUnitSampler {
        if let sampler=samplers[part.id],programs[part.id]==part.program{return sampler}
        let sampler=samplers[part.id] ?? AVAudioUnitSampler()
        if samplers[part.id]==nil{engine.attach(sampler);engine.connect(sampler,to:engine.mainMixerNode,format:nil);samplers[part.id]=sampler}
        try sampler.loadSoundBankInstrument(at:bank,program:UInt8(clamping:part.program),bankMSB:UInt8(part.percussion ? kAUSampler_DefaultPercussionBankMSB:kAUSampler_DefaultMelodicBankMSB),bankLSB:UInt8(kAUSampler_DefaultBankLSB))
        programs[part.id]=part.program;return sampler
    }
    func startEngine()throws{if !engine.isRunning{try engine.start()}}
    func preview(_ note:Note,part:Part){queue.async{[self] in do{let sampler=try self.sampler(part);try startEngine();guard let pitch=note.pitch else{return};let midi=UInt8(clamping:pitch.midi+note.transpose);sampler.startNote(midi,withVelocity:90,onChannel:0);queue.asyncAfter(deadline:.now()+0.3){sampler.stopNote(midi,onChannel:0)}}catch{outputError?(error.localizedDescription)}}}
    func stop(){queue.async{[self] in generation+=1;timer?.cancel();timer=nil;for sampler in samplers.values{sampler.sendController(123,withValue:0,onChannel:0)}}}
    func play(_ playback:Playback,startBeat:Double,bpm:Double,progress:@escaping(Double,Set<String>)->Void,finished:@escaping()->Void) {
        queue.async{[self] in do{
            generation+=1;let token=generation;timer?.cancel();for sampler in samplers.values{sampler.sendController(123,withValue:0,onChannel:0)}
            let partMap=Dictionary(uniqueKeysWithValues:playback.parts.map{($0.id,$0)});for part in playback.parts{_ = try sampler(part)};try startEngine()
            let events=playback.events.filter{$0.beat+$0.duration>startBeat}.sorted{$0.beat<$1.beat};var next=0;var active:[String:(PlaybackEvent,Double)]=[:]
            let started=ProcessInfo.processInfo.systemUptime
            let source=DispatchSource.makeTimerSource(queue:queue);timer=source;source.schedule(deadline:.now(),repeating:.milliseconds(10))
            source.setEventHandler{[self] in guard token==generation else{return};let elapsed=ProcessInfo.processInfo.systemUptime-started,beat=startBeat+elapsed*bpm/60
                for (id,value) in active where beat>=value.1{samplers[value.0.partId]?.stopNote(UInt8(value.0.midi),onChannel:0);active.removeValue(forKey:id)}
                while next<events.count&&events[next].beat<=beat{let event=events[next];next+=1;if event.beat+event.duration<=beat{continue};if partMap[event.partId] != nil{samplers[event.partId]?.startNote(UInt8(event.midi),withVelocity:UInt8(clamping:event.velocity),onChannel:0);active[event.id]=(event,event.beat+max(0.1,event.duration))}}
                progress(beat,Set(active.keys));if next==events.count&&active.isEmpty{source.cancel();timer=nil;finished()}
            };source.resume()
        }catch{outputError?(error.localizedDescription);finished()}}
    }
    /// Real offline audio render used by tests; avoids reliance on an output device.
    static func sample(program:Int)throws->[Float] {
        let rack=AudioRack(),part=Part(id:"test",name:"Test",staves:1,program:program,percussion:false),sampler=try rack.sampler(part)
        let format=AVAudioFormat(standardFormatWithSampleRate:44100,channels:2)!
        try rack.engine.enableManualRenderingMode(.offline,format:format,maximumFrameCount:1024);try rack.engine.start();sampler.startNote(69,withVelocity:100,onChannel:0)
        let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:1024)!,frames=22050;var result:[Float]=[]
        while result.count<frames {let status=try rack.engine.renderOffline(1024,to:buffer);if status == .success,let samples=buffer.floatChannelData{result.append(contentsOf:UnsafeBufferPointer(start:samples[0],count:Int(buffer.frameLength)))}else if status == .error{throw EditorError.message("Offline instrument rendering failed.")}}
        sampler.stopNote(69,onChannel:0);rack.engine.stop();return Array(result.prefix(frames))
    }
}
