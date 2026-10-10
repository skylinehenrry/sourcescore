import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor final class EditorModel:ObservableObject {
    let core=CoreEngine(),files=FileStore(),audio=AudioRack();lazy var engraver=Engraver()
    @Published var summary:Summary?;@Published var scene:VectorScene?;@Published var notes:[String:Note]=[:]
    @Published var selection:Set<String>=[];@Published var page=0;@Published var zoom=0.8
    @Published var partId:String?;@Published var inspector=true;@Published var instruments=false;@Published var diagnostics=false
    @Published var file:FileReference?;@Published var dirty=false;@Published var canUndo=false;@Published var canRedo=false
    @Published var status="Open a MusicXML score";@Published var error:String?;@Published var loading=false;@Published var rendering=false
    @Published var playing=false;@Published var bpm:Double=100;@Published var audition=true;@Published var activeNotes:Set<String>=[]
    @Published var pendingPlan:[String:Any]?;@Published var planDescription="";@Published var measureInput=""
    @Published var lastEditMilliseconds:Double=0;@Published var programOverrides:[String:Int]=[:]
    private var revision=0,generation=0,renderTask:Task<Void,Never>?,editTail:Task<Void,Never>?,checkTimer:Timer?
    private var renderBusy=false,needsRender=false
    let barsPerPage=4
    var primary:Note? {selection.sorted().last.flatMap{notes[$0]}}
    var pageCount:Int {max(1,((summary?.measureCount ?? 0)+barsPerPage-1)/barsPerPage)}
    var displayName:String {file?.url.lastPathComponent ?? summary?.title ?? "SourceScore"}
    init(){audio.outputError={ [weak self] message in DispatchQueue.main.async{self?.error=message}};checkTimer=Timer.scheduledTimer(withTimeInterval:10,repeats:true){[weak self]_ in Task{@MainActor in guard let self,let file=self.file,!self.loading else{return};if await self.files.changed(file){self.status="File changed externally — reopen or use Save As"}}}}
    func openPanel(){let panel=NSOpenPanel();panel.allowedContentTypes=[UTType(filenameExtension:"musicxml") ?? .xml,.xml];panel.canChooseDirectories=false;panel.allowsMultipleSelection=false;if panel.runModal() == .OK,let url=panel.url{Task{await open(url)}}}
    func allowReplace() async ->Bool {
        await editTail?.value;guard dirty else{return true};let alert=NSAlert();alert.messageText="Save changes to this score?";alert.informativeText="Your unsaved edits will be lost if you discard them.";alert.addButton(withTitle:"Save");alert.addButton(withTitle:"Discard");alert.addButton(withTitle:"Cancel")
        let answer=alert.runModal();if answer == .alertFirstButtonReturn{return await save()};return answer == .alertSecondButtonReturn
    }
    func open(_ url:URL)async {guard !loading,await allowReplace() else{return};loading=true;status="Reading score…";audio.stop();playing=false
        do{let (source,reference)=try await files.open(url);try await load(source,reference:reference)}catch{self.error=errorMessage(error)};loading=false
    }
    func example(){Task{guard await allowReplace() else{return};loading=true;do{try await load(String(contentsOf:resource("example","musicxml"),encoding:.utf8),reference:nil)}catch{self.error=errorMessage(error)};loading=false}}
    private func load(_ source:String,reference:FileReference?)async throws {
        let result=try await core.decode(Summary.self,"open",["source":source]);generation+=1;summary=result;file=reference;dirty=false;canUndo=false;canRedo=false;revision=result.revision;bpm=result.initialTempo;notes=[:];selection=[];page=0;scene=nil;partId=nil;programOverrides=[:];status="\(result.parts.count) instruments · \(result.measureCount) measures";updateTitle();scheduleRender()
    }
    func select(_ id:String,extend:Bool=false,range:Bool=false){if extend{if selection.contains(id){selection.remove(id)}else{selection.insert(id)}}else if range,let current=primary,let next=notes[id],current.partId==next.partId{let list=notes.values.filter{$0.partId==current.partId}.sorted{($0.measureIndex,$0.index)<($1.measureIndex,$1.index)};if let a=list.firstIndex(where:{$0.id==current.id}),let b=list.firstIndex(where:{$0.id==id}){selection.formUnion(list[min(a,b)...max(a,b)].map{$0.id})}}else{selection=[id]}
        if let note=notes[id],audition,let part=effectivePart(note.partId){audio.preview(note,part:part)}
    }
    func edit(_ method:String,_ args:[String:Any]) {
        guard summary != nil,!loading else{return};audio.stop();playing=false
        let previous=editTail
        editTail=Task {await previous?.value;let started=ProcessInfo.processInfo.systemUptime
            do{let value=try await core.decode(EditState.self,method,args);for note in value.notes{notes[note.id]=note};dirty=value.dirty;canUndo=value.canUndo;canRedo=value.canRedo;revision=value.revision;status=value.label;lastEditMilliseconds=(ProcessInfo.processInfo.systemUptime-started)*1000;updateTitle()
                if audition,let note=primary,let part=effectivePart(note.partId){audio.preview(note,part:part)}
                scheduleRender()
            }catch{self.error=errorMessage(error)}
        }
    }
    func undo(){edit("undo",["ids":Array(selection)])}
    func redo(){edit("redo",["ids":Array(selection)])}
    func duration(_ type:String,_ dots:Int){guard let note=primary else{return};Task {await editTail?.value;do{let data=try await core.call("plan-duration",["id":note.id,"type":type,"dots":dots]);pendingPlan=try JSONSerialization.jsonObject(with:data) as? [String:Any];planDescription=pendingPlan?["description"] as? String ?? ""}catch{self.error=errorMessage(error)}}}
    func applyDuration(){guard let plan=pendingPlan else{return};pendingPlan=nil;edit("duration",["plan":plan])}
    func adjacent(_ delta:Int){Task{do{let note=try await core.decode(Note.self,"adjacent",["id":primary?.id as Any? ?? NSNull(),"delta":delta]);notes[note.id]=note;selection=[note.id];let next=note.measureIndex/barsPerPage;if page != next{page=next;scheduleRender()}}catch{self.error=errorMessage(error)}}}
    func flip(_ delta:Int){let next=max(0,min(pageCount-1,page+delta));guard next != page else{return};page=next;selection=[];scheduleRender()}
    func go(){guard let summary else{return};let index=summary.measureLabels.firstIndex(of:measureInput) ?? (Int(measureInput).map{$0-1} ?? -1);guard index>=0&&index<summary.measureCount else{error="Measure not found.";return};page=index/barsPerPage;selection=[];measureInput="";scheduleRender()}
    func showPart(_ id:String?){partId=id;selection=[];scheduleRender()}
    func scheduleRender(){renderTask?.cancel();renderTask=Task{try? await Task.sleep(nanoseconds:35_000_000);guard !Task.isCancelled else{return};await renderPage()}}
    private func renderPage()async {
        if renderBusy{needsRender=true;return};renderBusy=true;rendering=true;let token=generation,currentPage=page,wanted=revision
        do{var args:[String:Any]=["start":page*barsPerPage,"count":barsPerPage];if let partId{args["partId"]=partId};let payload=try await core.call("page",args);let (scene,pageNotes)=try await engraver.render(payload)
            if generation==token&&page==currentPage&&revision==wanted{self.scene=scene;for note in pageNotes{notes[note.id]=note};status="Page \(page+1) of \(pageCount) · \(scene.targets.count) selectable events"}
            else{needsRender=true}
        }catch{if generation==token{self.error=errorMessage(error)}}
        renderBusy=false;rendering=false;if needsRender{needsRender=false;scheduleRender()}
    }
    @discardableResult func save(as saveAs:Bool=false)async->Bool {
        guard summary != nil,!loading else{return false};await editTail?.value;loading=true;defer{loading=false}
        do{
            _=try await core.call("validate-save");let source=try await core.decode(String.self,"source")
            var target=file
            if saveAs||target==nil {let panel=NSSavePanel();panel.allowedContentTypes=[UTType(filenameExtension:"musicxml") ?? .xml,.xml];panel.nameFieldStringValue=file?.url.lastPathComponent ?? "Score.musicxml";panel.directoryURL=file?.url.deletingLastPathComponent();guard panel.runModal() == .OK,let url=panel.url else{return false};let grant=try await files.target(url)
                if let original=file,grant.url==original.url,grant.hash != original.hash{throw EditorError.message("The original changed externally. Save As must use a different destination.")};target=grant}
            let result=try await files.save(source,to:target!);file=result.reference;let state=try await core.decode(EditState.self,"mark-saved");dirty=state.dirty;status=result.unchanged ? "Saved — unchanged bytes" : result.backup != nil ? "Saved — backup created":"Saved";updateTitle();return true
        }catch{self.error=errorMessage(error);return false}
    }
    func effectivePart(_ id:String)->Part? {guard var p=summary?.parts.first(where:{$0.id==id}) else{return nil};p.program=programOverrides[id] ?? p.program;return p}
    func togglePlayback(){if playing{audio.stop();playing=false;activeNotes=[];return};Task{await editTail?.value;do{var arrangement=try await core.decode(Playback.self,"playback");arrangement.parts=arrangement.parts.map{effectivePart($0.id) ?? $0};let start=primary?.measureIndex ?? page*barsPerPage;playing=true;audio.play(arrangement,startBeat:arrangement.measureBeats[min(start,arrangement.measureBeats.count-1)],bpm:bpm,progress:{[weak self]_,ids in DispatchQueue.main.async{self?.activeNotes=ids}},finished:{[weak self] in DispatchQueue.main.async{self?.playing=false;self?.activeNotes=[]}})}catch{self.error=errorMessage(error)}}}
    func stop(){audio.stop();playing=false;activeNotes=[]}
    func soundBank(){let panel=NSOpenPanel();panel.allowedContentTypes=[UTType(filenameExtension:"sf2") ?? .data,UTType(filenameExtension:"dls") ?? .data];if panel.runModal() == .OK,let url=panel.url{audio.stop();audio.queue.async{[audio] in audio.bank=url;audio.programs.removeAll()};status="Sound bank: \(url.lastPathComponent)"}}
    func updateTitle(){NSApp.windows.first?.title=displayName+(dirty ? " • Edited":"");NSApp.windows.first?.isDocumentEdited=dirty}
    private func errorMessage(_ error:Error)->String {(error as? LocalizedError)?.errorDescription ?? error.localizedDescription}
}
