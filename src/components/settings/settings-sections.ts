import {
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Shield,
  Tags,
  User,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { hasMinRole, type AccountRole } from '@/lib/auth/roles';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'groups',
  'templates',
  'quick-replies',
  'fields',
  'deals',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/**
 * Rail grouping + role-based access control.
 *
 * `minRole` decides whether the section appears in the rail
 * (`SettingsRail`) and whether its corresponding `?tab=` URL is
 * accepted (`SettingsPageInner`) — see `canAccessSection` below and
 * docs/superpowers/specs/2026-09-09-settings-role-gating-design.md.
 */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  minRole: AccountRole;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top', minRole: 'viewer' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account', minRole: 'viewer' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account', minRole: 'viewer' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account', minRole: 'viewer' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace', minRole: 'admin' },
  groups: { id: 'groups', label: 'Groups', icon: Users, group: 'workspace', minRole: 'admin' },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'workspace', minRole: 'agent' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace', minRole: 'agent' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace', minRole: 'agent' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace', minRole: 'agent' },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace', minRole: 'agent' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace', minRole: 'agent' },
};

/**
 * True when `role` reaches the `minRole` of the section. `role === null`
 * (profile still loading, or profile absent) is treated as `viewer`
 * — the role of least privilege — to never enable a sensitive section
 * before knowing the user's actual role.
 */
export function canAccessSection(
  section: SettingsSection,
  role: AccountRole | null,
): boolean {
  return hasMinRole(role ?? 'viewer', SECTION_META[section].minRole);
}

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
