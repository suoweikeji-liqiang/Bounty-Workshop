import type { UserProfile } from '../types'

export function hasAnyRole(profile: UserProfile | null, allowedRoles: string[]): boolean {
  if (!profile) {
    return false
  }
  return profile.roles.some((role) => allowedRoles.includes(role))
}

export function hasRole(profile: UserProfile | null, role: string): boolean {
  if (!profile) {
    return false
  }
  return profile.roles.includes(role)
}
