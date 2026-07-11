import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../resources/PrivacyInfo.xcprivacy');
const destination = resolve(import.meta.dirname, '../ios/App/App/PrivacyInfo.xcprivacy');
const projectPath = resolve(import.meta.dirname, '../ios/App/App.xcodeproj/project.pbxproj');

if (!existsSync(destination.replace(/PrivacyInfo\.xcprivacy$/, ''))) {
  console.error('iOS project not found. Run `npm run ios:add` first.');
  process.exit(1);
}
copyFileSync(source, destination);
let project = readFileSync(projectPath, 'utf8');
if (!project.includes('PrivacyInfo.xcprivacy in Resources')) {
  project = project
    .replace('/* End PBXBuildFile section */', '\t\tE70A6E2C0010000000000001 /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = E70A6E2C0010000000000002 /* PrivacyInfo.xcprivacy */; };\n/* End PBXBuildFile section */')
    .replace('/* End PBXFileReference section */', '\t\tE70A6E2C0010000000000002 /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n/* End PBXFileReference section */')
    .replace('children = (\n\t\t\t\t50379B222058CBB4000EE86E /* capacitor.config.json */,', 'children = (\n\t\t\t\tE70A6E2C0010000000000002 /* PrivacyInfo.xcprivacy */,\n\t\t\t\t50379B222058CBB4000EE86E /* capacitor.config.json */,')
    .replace('files = (\n\t\t\t\t504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,', 'files = (\n\t\t\t\tE70A6E2C0010000000000001 /* PrivacyInfo.xcprivacy in Resources */,\n\t\t\t\t504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,');
  writeFileSync(projectPath, project);
}
console.log(`Copied PrivacyInfo.xcprivacy to ${destination}`);
