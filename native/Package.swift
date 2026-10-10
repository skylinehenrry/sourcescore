// swift-tools-version: 5.10
import PackageDescription
let package = Package(name:"SourceScore",platforms:[.macOS(.v14)],products:[.executable(name:"SourceScore",targets:["SourceScore"])],targets:[
  .executableTarget(name:"SourceScore",path:".",exclude:["Tests","Package.swift","core-api.ts","render-entry.ts"],sources:["Sources/SourceScore"],resources:[.copy("Resources")])
])
