export type SupportedPlatform = 'windows' | 'web' | 'android'

export interface SkillManifestEntry { id: string; path: string }
export interface RuleSetManifestEntry { id: string; path: string }

export interface SkillPackageManifest {
  schemaVersion: 1
  id: string
  version: string
  name: string
  description: string
  author: string
  license: string
  minAppVersion: string
  platforms: SupportedPlatform[]
  skills: SkillManifestEntry[]
  ruleSets: RuleSetManifestEntry[]
}

export interface SkillDefinition {
  id: string
  name: string
  stages: string[]
  inputKind?: string
  outputKind?: string
  body: string
}

export interface ContentPackageFile { path: string; content: string }
export interface ContentPackage { manifest: SkillPackageManifest; files: ContentPackageFile[] }
export interface InstalledContentPackage extends ContentPackage { enabled: boolean; installedAt: number }
