# Firestore change required for the marketer role

The local `../firestore.rules` now includes this rule. The live Firestore deployment cannot be verified from this workspace.

The app recognizes both `users/{uid}.role` values `marketing` and `marketer`. It writes a minimized, finance-free analytics projection to `hub/marketing` after an owner/admin save. The owner can also create or refresh it with the explicit **تحديث بيانات المسوّق** button; that action writes only `hub/marketing`, not `hub/main`. A marketing user reads only this document and their own `users/{uid}` role record. Do not grant marketing users read access to `hub/main`, finance, backups, teachers, or attendance.

The local rules define this helper and the matching rule for `hub/marketing`:

```javascript
function isMarketing() { return roleIs("marketer") || roleIs("marketing"); }

match /hub/marketing {
  allow read: if isOwner() || isMarketing();
  allow create, update: if isOwner() || isAdmin();
  allow delete: if false;
}
```

Create the Firebase Auth account separately, then set `users/{uid}.role` to `marketer` as the owner. Existing student records remain readable without migration; optional `profileId`, `formerAt`, `subscriptionClass`, and `subscriptionSource` fields are added only as records are newly saved/edited. Historical rows keep using the existing phone/name Retention fallback unless separately linked by a trusted owner action.

The projection omits student phone numbers, notes, attendance, lead data, expenses, finance totals, and per-student amounts for registrations not classified as new subscriptions. The marketer role is read-only in the app.
