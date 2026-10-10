import SwiftUI
import AppKit

final class AppDelegate:NSObject,NSApplicationDelegate,NSWindowDelegate {
    weak var model:EditorModel?
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {
        guard let model,model.dirty else{return .terminateNow};Task{let accepted=await model.allowReplace();NSApp.reply(toApplicationShouldTerminate:accepted)};return .terminateLater
    }
    func application(_ sender:NSApplication,openFiles filenames:[String]){if let filename=filenames.first{Task{await model?.open(URL(fileURLWithPath:filename))}};sender.reply(toOpenOrPrint:.success)}
    func windowShouldClose(_ sender:NSWindow)->Bool {guard let model,model.dirty else{return true};Task{if await model.allowReplace(){sender.delegate=nil;sender.close()}};return false}
}
@main struct SourceScoreApp:App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject var model=EditorModel()
    var body:some Scene {WindowGroup {
        EditorWindow(model:model).frame(minWidth:1000,minHeight:680).preferredColorScheme(.light).tint(.black)
            .onAppear{delegate.model=model;DispatchQueue.main.async{NSApp.windows.first?.delegate=delegate};if let path=CommandLine.arguments.dropFirst().first(where:{$0.lowercased().hasSuffix(".musicxml")||$0.lowercased().hasSuffix(".xml")}){Task{await model.open(URL(fileURLWithPath:path))}}}
    }.defaultSize(width:1360,height:900).commands {
        CommandGroup(replacing:.newItem){Button("Open…",action:model.openPanel).keyboardShortcut("o");Button("Open Example",action:model.example)}
        CommandGroup(replacing:.saveItem){Button("Save"){Task{await model.save()}}.keyboardShortcut("s").disabled(model.summary==nil);Button("Save As…"){Task{await model.save(as:true)}}.keyboardShortcut("s",modifiers:[.command,.shift]).disabled(model.summary==nil)}
        CommandGroup(replacing:.undoRedo){Button("Undo",action:model.undo).keyboardShortcut("z").disabled(!model.canUndo);Button("Redo",action:model.redo).keyboardShortcut("z",modifiers:[.command,.shift]).disabled(!model.canRedo)}
        CommandMenu("Navigate"){Button("Previous Page"){model.flip(-1)}.keyboardShortcut(.leftArrow,modifiers:.option).disabled(model.page==0);Button("Next Page"){model.flip(1)}.keyboardShortcut(.rightArrow,modifiers:.option).disabled(model.page+1>=model.pageCount)}
        CommandMenu("Playback"){Button(model.playing ? "Stop":"Play",action:model.togglePlayback).keyboardShortcut(.space,modifiers:[]);Toggle("Audition Selected and Edited Notes",isOn:$model.audition);Button("Choose SoundFont…",action:model.soundBank)}
    }}
}
struct EditorWindow:View {
    @ObservedObject var model:EditorModel
    private let types=["whole","half","quarter","eighth","16th","32nd","64th"]
    var body:some View {
        VStack(spacing:0){
            HStack(spacing:16){
                if let summary=model.summary {Text(summary.title).font(.headline).lineLimit(1);Spacer();Button{model.flip(-1)}label:{Image(systemName:"chevron.left")}.disabled(model.page==0);Text("\(model.page+1) / \(model.pageCount)").monospacedDigit().font(.caption);Button{model.flip(1)}label:{Image(systemName:"chevron.right")}.disabled(model.page+1>=model.pageCount);TextField("Measure",text:$model.measureInput).frame(width:75).onSubmit(model.go);Button("Go",action:model.go)}else{Text("SourceScore").font(.headline);Spacer()}
            }.padding(.horizontal,20).padding(.vertical,12)
            Divider()
            HStack(spacing:0){
                if model.instruments,let summary=model.summary {VStack(alignment:.leading,spacing:8){Button("All instruments"){model.showPart(nil)}.buttonStyle(.plain).fontWeight(model.partId==nil ? .semibold:.regular);Divider();ScrollView{VStack(alignment:.leading,spacing:12){ForEach(summary.parts){part in Button{model.showPart(part.id)}label:{Text(part.name).frame(maxWidth:.infinity,alignment:.leading).fontWeight(model.partId==part.id ? .semibold:.regular)}.buttonStyle(.plain)}}}}.padding(16).frame(width:175);Divider()}
                if model.summary != nil {ScoreCanvas(model:model).overlay(alignment:.topTrailing){if model.rendering{ProgressView().controlSize(.small).padding(12)}}}
                else {VStack(spacing:18){Image(systemName:"music.note").font(.system(size:42,weight:.light));Text("Open a MusicXML score").font(.title2);Button("Open…",action:model.openPanel).keyboardShortcut("o");Button("Orchestral example",action:model.example).buttonStyle(.plain).foregroundStyle(.secondary)}.frame(maxWidth:.infinity,maxHeight:.infinity)}
                if model.inspector,let note=model.primary {Divider();inspector(note).frame(width:210).padding(18)}
            }.background(.white)
            if model.diagnostics,let summary=model.summary {Divider();ScrollView{VStack(alignment:.leading,spacing:10){if summary.diagnostics.isEmpty{Text("No timing issues detected").foregroundStyle(.secondary)};ForEach(summary.diagnostics){d in Button{model.page=d.measureIndex/model.barsPerPage;model.selection=d.noteId.map{[$0]} ?? [];model.scheduleRender()}label:{HStack{Text(d.instrument).frame(width:150,alignment:.leading);Text("m. \(d.measure)").frame(width:80,alignment:.leading);Text(d.message);Spacer();if let actual=d.actual{Text("\(actual) / \(d.expected ?? "—")").monospacedDigit()}}.font(.caption)}.buttonStyle(.plain)}}.padding(14)}.frame(maxHeight:150)}
            Divider();HStack{if model.loading{ProgressView().controlSize(.mini)};Text(model.status).lineLimit(1);Spacer();if model.lastEditMilliseconds>0{Text(String(format:"%.0f ms",model.lastEditMilliseconds)).foregroundStyle(.tertiary)};if model.dirty{Text("Edited")}}.font(.caption).foregroundStyle(.secondary).padding(.horizontal,16).padding(.vertical,7)
        }.background(.white).toolbar {
            ToolbarItemGroup(placement:.navigation){Button(action:model.openPanel){Image(systemName:"folder")}.help("Open");Button{Task{await model.save()}}label:{Image(systemName:"square.and.arrow.down")}.disabled(model.summary==nil).help("Save");Button(action:model.undo){Image(systemName:"arrow.uturn.backward")}.disabled(!model.canUndo);Button(action:model.redo){Image(systemName:"arrow.uturn.forward")}.disabled(!model.canRedo)}
            ToolbarItemGroup(placement:.principal){Button(action:model.togglePlayback){Image(systemName:model.playing ? "stop.fill":"play.fill")}.disabled(model.summary==nil).help("Play score");TextField("BPM",value:$model.bpm,format:.number).frame(width:42);Text("BPM").font(.caption).foregroundStyle(.secondary);Toggle(isOn:$model.audition){Image(systemName:"speaker.wave.2")}.toggleStyle(.button).help("Audition notes")}
            ToolbarItemGroup(placement:.automatic){Button{model.zoom=max(0.35,model.zoom-0.1)}label:{Image(systemName:"minus.magnifyingglass")};Text("\(Int(model.zoom*100))%").font(.caption);Button{model.zoom=min(2,model.zoom+0.1)}label:{Image(systemName:"plus.magnifyingglass")};Button{model.instruments.toggle()}label:{Image(systemName:"sidebar.left")};Button{model.inspector.toggle()}label:{Image(systemName:"sidebar.right")};Button{model.diagnostics.toggle()}label:{Image(systemName:"exclamationmark.circle")}}
        }.alert("Operation could not be completed",isPresented:Binding(get:{model.error != nil},set:{if !$0{model.error=nil}})){Button("OK"){model.error=nil}}message:{Text(model.error ?? "")}
            .sheet(isPresented:Binding(get:{model.pendingPlan != nil},set:{if !$0{model.pendingPlan=nil}})){VStack(alignment:.leading,spacing:20){Text("Keep the measure balanced").font(.headline);Text(model.planDescription);HStack{Spacer();Button("Cancel"){model.pendingPlan=nil};Button("Apply",action:model.applyDuration).keyboardShortcut(.defaultAction)}}.padding(24).frame(width:440)}
    }
    private func inspector(_ note:Note)->some View {
        VStack(alignment:.leading,spacing:18){Text(note.label).font(.system(size:28,weight:.light));Text("Measure \(note.measureNumber) · Staff \(note.staff) · Voice \(note.voice)").font(.caption).foregroundStyle(.secondary)
            if let pitch=note.pitch {
                HStack{Picker("Step",selection:Binding(get:{pitch.step},set:{model.edit("pitch",["id":note.id,"pitch":["step":$0,"alter":pitch.alter,"octave":pitch.octave]])})){ForEach(["C","D","E","F","G","A","B"],id:\.self){Text($0)}}.labelsHidden();Stepper("Octave \(pitch.octave)",value:Binding(get:{pitch.octave},set:{model.edit("pitch",["id":note.id,"pitch":["step":pitch.step,"alter":pitch.alter,"octave":$0]])}),in:0...9)}
                HStack{ForEach([-2,-1,0,1,2],id:\.self){alter in Button(["𝄫","♭","♮","♯","𝄪"][alter+2]){model.edit("accidental",["ids":Array(model.selection),"alter":alter])}.font(.title3).buttonStyle(.borderless).frame(maxWidth:.infinity)}}
                Button("Enharmonic spelling"){model.edit("respell",["id":note.id,"direction":1])}.buttonStyle(.plain).font(.caption)
                Text("↑ ↓ semitone · ⇧ ↑ ↓ octave").font(.caption2).foregroundStyle(.tertiary)
            }
            Divider();Picker("Duration",selection:Binding(get:{note.type},set:{model.duration($0,note.dots)})){ForEach(types,id:\.self){Text($0)}}
            HStack{Picker("Dots",selection:Binding(get:{note.dots},set:{model.duration(note.type,$0)})){ForEach(0...2,id:\.self){Text(String($0))}};Picker("Voice",selection:Binding(get:{note.voice},set:{model.edit("voice",["id":note.id,"voice":$0])})){ForEach(1...8,id:\.self){Text(String($0)).tag(String($0))}}}
            if let part=model.effectivePart(note.partId){Divider();Text(part.name).font(.caption).fixedSize(horizontal:false,vertical:true);Picker("Sound",selection:Binding(get:{part.program},set:{model.programOverrides[part.id]=$0})){ForEach(Self.sounds,id:\.0){entry in Text(entry.1).tag(entry.0)}}.labelsHidden()}
            Spacer()
        }
    }
    static let sounds=[(0,"Piano"),(9,"Glockenspiel"),(40,"Violin"),(41,"Viola"),(42,"Cello"),(43,"Double bass"),(46,"Harp"),(47,"Timpani"),(48,"Strings"),(56,"Trumpet"),(57,"Trombone"),(58,"Tuba"),(60,"Horn"),(68,"Oboe"),(70,"Bassoon"),(71,"Clarinet"),(72,"Piccolo"),(73,"Flute")]
}
