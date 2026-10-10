import Foundation
import AppKit
@main struct NativeCheck {
    static func check(_ condition:Bool,_ message:String)throws {if !condition{throw EditorError.message(message)}}
    static func main()async throws {
        let source=try String(contentsOf:resource("example","musicxml"),encoding:.utf8),engine=CoreEngine()
        let summary=try await engine.decode(Summary.self,"open",["source":source]);try check(summary.parts.count==6,"Instrument summary")
        let original=try await engine.decode(String.self,"source");try check(original==source,"No-op JSC source changed bytes")
        let start=ProcessInfo.processInfo.systemUptime
        let state=try await engine.decode(EditState.self,"semitone",["ids":["0:0:0"],"delta":1]);try check(state.notes[0].pitch?.label=="G5","Semitone movement")
        print(String(format:"PASS JavaScriptCore pitch edit: %.2f ms",(ProcessInfo.processInfo.systemUptime-start)*1000))
        _=try await engine.call("undo",["ids":["0:0:0"]]);let undone=try await engine.decode(String.self,"source");try check(undone==source,"Exact undo failed")
        let store=FileStore(),directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true);defer{try? FileManager.default.removeItem(at:directory)}
        let path=directory.appendingPathComponent("score.musicxml");try Data(source.utf8).write(to:path);let (_,file)=try await store.open(path);let noop=try await store.save(source,to:file);try check(noop.unchanged&&noop.backup==nil,"No-op file save")
        let changed=source.replacingOccurrences(of:"<alter>1</alter>",with:"<alter>0</alter>");let saved=try await store.save(changed,to:file);try check(try Data(contentsOf:saved.backup!)==Data(source.utf8),"Exact backup")
        let external=Data((changed+"<!-- external -->").utf8);try external.write(to:path);var blocked=false
        do{_ = try await store.save(changed,to:saved.reference)}catch{blocked=true};try check(blocked,"External conflict was overwritten");try check(try Data(contentsOf:path)==external,"External bytes changed")
        print("PASS Native no-op, atomic save, exact backup and conflict protection")
        let scene=try VectorScene.parse("<svg width='100' height='100' viewBox='0 0 100 100'><g data-source-note='0:0:0'><path d='M0 0L20 0L20 10Z'/></g></svg>")
        try check(scene.marks.count==1&&scene.marks[0].style.owner=="0:0:0","Vector identity")
        print("PASS Native vector path and note identity")
        let piano=try AudioRack.sample(program:0),flute=try AudioRack.sample(program:73)
        try check(piano.reduce(0){$0+abs($1)}>0.1&&flute.reduce(0){$0+abs($1)}>0.1,"Audio output is silent")
        try check(zip(piano,flute).reduce(0){$0+abs($1.0-$1.1)}>0.1,"Different instruments have identical audio")
        print("PASS Actual piano/flute audio: nonzero, different rendered waveforms")
    }
}
