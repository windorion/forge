#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "digest"
require "pathname"
require "xcodeproj"

repo_root = Pathname.new(__dir__).join("..").expand_path
project_path = repo_root.join("ForgeApp.xcodeproj")
FileUtils.rm_rf(project_path)

project = Xcodeproj::Project.new(project_path.to_s)
project.root_object.compatibility_version = "Xcode 16.0"
project.root_object.development_region = "en"

app = project.new_target(:application, "ForgeAppUIHost", :osx, "14.0")
ui_tests = project.new_target(:ui_test_bundle, "ForgeAppUITests", :osx, "14.0")
ui_tests.add_dependency(app)
app_dependency = ui_tests.dependencies.last
app_dependency_proxy = app_dependency.target_proxy

app_sources = project.main_group.new_group(
  "ForgeApp Sources",
  "apps/macos/Sources/ForgeApp"
)
Dir[repo_root.join("apps/macos/Sources/ForgeApp/*.swift")].sort.each do |path|
  reference = app_sources.new_file(File.basename(path))
  app.source_build_phase.add_file_reference(reference)
end

test_sources = project.main_group.new_group(
  "ForgeApp UI Tests",
  "Tests/ForgeAppUITests"
)
Dir[repo_root.join("Tests/ForgeAppUITests/*.swift")].sort.each do |path|
  reference = test_sources.new_file(File.basename(path))
  ui_tests.source_build_phase.add_file_reference(reference)
end

resources = project.main_group.new_group("ForgeApp Resources")
[
  "design_handoff_forge/assets/forge-logo.png",
  "apps/macos/Resources/appcast.xml",
  "apps/macos/Resources/Fonts/JetBrainsMono-Regular.ttf",
  "apps/macos/Resources/Fonts/JetBrainsMono-Bold.ttf",
  "apps/macos/Resources/Fonts/OFL.txt"
].each do |relative_path|
  reference = resources.new_file(relative_path)
  app.resources_build_phase.add_file_reference(reference)
end

project.build_configurations.each do |configuration|
  configuration.build_settings["MACOSX_DEPLOYMENT_TARGET"] = "14.0"
  configuration.build_settings["SWIFT_VERSION"] = "6.0"
end

app.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.windorion.forge.uitest-host"
  settings["PRODUCT_NAME"] = "Forge"
  settings["EXECUTABLE_NAME"] = "ForgeApp"
  settings["GENERATE_INFOPLIST_FILE"] = "YES"
  settings["INFOPLIST_KEY_CFBundleDisplayName"] = "Forge"
  settings["INFOPLIST_KEY_LSApplicationCategoryType"] = "public.app-category.developer-tools"
  settings["INFOPLIST_KEY_NSHighResolutionCapable"] = "YES"
  settings["MARKETING_VERSION"] = "0.4.2"
  settings["CURRENT_PROJECT_VERSION"] = "42"
  settings["CODE_SIGN_STYLE"] = "Automatic"
  settings["CODE_SIGN_IDENTITY"] = "-"
  settings["ENABLE_HARDENED_RUNTIME"] = "NO"
  settings["SWIFT_STRICT_CONCURRENCY"] = "complete"
  settings["LD_RUNPATH_SEARCH_PATHS"] = "$(inherited) @executable_path/../Frameworks"
end

ui_tests.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.windorion.forge.ui-tests"
  settings["PRODUCT_NAME"] = "ForgeAppUITests"
  settings["GENERATE_INFOPLIST_FILE"] = "YES"
  settings["TEST_TARGET_NAME"] = app.name
  settings["CODE_SIGN_STYLE"] = "Automatic"
  settings["CODE_SIGN_IDENTITY"] = "-"
  settings["SWIFT_VERSION"] = "6.0"
end

# TargetAttributes contain target UUID strings. Predictabilize the object graph
# before adding those strings so random pre-generation UUIDs cannot influence
# the deterministic tree hashes.
project.predictabilize_uuids
{
  app_dependency => "ForgeAppUITests dependency on ForgeAppUIHost",
  app_dependency_proxy => "ForgeAppUITests dependency proxy for ForgeAppUIHost"
}.each do |object, seed|
  old_uuid = object.uuid
  stable_uuid = Digest::MD5.hexdigest(seed).upcase
  object.instance_variable_set(:@uuid, stable_uuid)
  project.objects_by_uuid.delete(old_uuid)
  project.objects_by_uuid[stable_uuid] = object
end
project.root_object.attributes["TargetAttributes"] ||= {}
project.root_object.attributes["TargetAttributes"][ui_tests.uuid] = {
  "CreatedOnToolsVersion" => "26.2",
  "TestTargetID" => app.uuid
}
project.root_object.attributes["TargetAttributes"][app.uuid] = {
  "CreatedOnToolsVersion" => "26.2"
}
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(ui_tests, false)
scheme.add_test_target(ui_tests)
scheme.set_launch_target(app)
scheme.test_action.build_configuration = "Debug"
scheme.launch_action.build_configuration = "Debug"
scheme.profile_action.build_configuration = "Release"
scheme.archive_action.build_configuration = "Release"
scheme.save_as(project_path.to_s, "ForgeAppUI", true)

puts "Generated #{project_path.relative_path_from(repo_root)} with shared ForgeAppUI scheme."
