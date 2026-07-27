/**
 * حالة «المستخدم النشط حاليًا» في العملية الرئيسية — القرار المعتمد في
 * المرحلة 2 (بديلًا عن غياب مفهوم الجلسة): متغيّر بسيط يُحدَّث بـlogin()،
 * يغذّي audit_logs.user_id وسقف خصم الكاشير تلقائيًا في العمليات اللاحقة.
 * مرحلة الشاشة الفعلية (تسجيل الدخول UI) في المرحلة 4.
 */
import type { AppUser } from '../shared/types'

let currentUser: AppUser | null = null

export function setCurrentUser(user: AppUser | null): void {
  currentUser = user
}

export function getCurrentUser(): AppUser | null {
  return currentUser
}

export function clearCurrentUser(): void {
  currentUser = null
}
