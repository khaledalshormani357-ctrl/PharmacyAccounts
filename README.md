# PharmacyAccounts — نظام ERP للصيدليات

PharmacyAccounts is a pharmacy ERP app (React Native + Expo) for daily pharmacy work: point of sale (POS), purchases, inventory with batches and expiry tracking, sale/purchase returns, a cashbox split into three boxes (Daily, Pharmacy, Bank/Exchange), customers and suppliers with credit limits and balances, PDF reports, and a shared drug reference catalog. Data is stored locally on the device, so the app works offline after the first sync/download of the catalog.

نظام محاسبة ومخزون للصيدليات: نقطة بيع، مشتريات، مخزون بدفعات وتواريخ صلاحية، مرتجعات، صندوق بثلاثة صناديق، عملاء وموردون، تقارير PDF، وكتالوج أدوية مشترك. يعمل محلياً دون اتصال بعد أول مزامنة.

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

Copy `.env.example` to `.env` and fill in the Supabase URL and publishable/anon key. Never put the service_role key in the app.

### 2. Start the Project

- Start the development server (choose your platform):

```bash
pnpm start         # Start Expo development server
pnpm android       # Launch Android emulator
pnpm ios           # Launch iOS simulator
pnpm web           # Start the web version
```

- Reset the project (clear cache, etc.):

```bash
pnpm run reset-project
```

### 3. Test and Typecheck

```bash
pnpm test           # Unit tests (pnpm run test:units)
pnpm run typecheck  # tsc --noEmit
pnpm run lint
```

## Security note

`.env` is not tracked in git (see `.gitignore`); only `.env.example` is committed. Because a previous `.env` was tracked, rotate the Supabase anon/publishable key in the Supabase dashboard and update the devices. SQL migrations under `supabase/` are applied manually in the Supabase SQL Editor — they are not applied automatically by the app.

## الصلاحيات (Permissions)

The permission map lives in `services/employee-permissions.ts`: 25 permissions in 5 groups, with defaults per role — ADMIN (everything), MANAGER (everything except user management), PHARMACIST, CASHIER (cash sales, customers, cashbox), STOREKEEPER (inventory, stocktake, opening stock), ACCOUNTANT (reports, profit, audit). A per-user override can grant or revoke a single permission from the employee-permissions screen (`app/employee-access.tsx`); overrides win over role defaults.

Enforcement is real and lives in the services (`services/erp-database.ts`), not in button visibility: every sensitive operation (creating/cancelling sales and purchases, returns, inventory edits and adjustments, opening stock, free samples, customer management and collection, credit sales, user management, backup/restore) checks the current actor first. A denied call changes nothing and is recorded in the audit log as `PERMISSION_DENIED`. Hiding a link in the UI is only a hint.

How the session is bound: after a cloud sign-in (`app/login.tsx`, including biometric sign-in, which goes through the same path), the login username is resolved to a matching active local user (`services/session.ts`) and that user becomes the current actor. A cloud login with no matching local record is bound to no actor and may read data but is denied every guarded write. Signing out clears the actor. In local mode (no Supabase configured) there is no login, so no actor is bound and the app behaves as before — single-user, protected only by the device PIN. Full enforcement is therefore active only after a cloud login.

خريطة الصلاحيات في `services/employee-permissions.ts`: 25 صلاحية في 5 مجموعات وافتراضيات لكل دور، ويمكن منح تجاوز فردي من شاشة صلاحيات الموظفين. الفرض الحقيقي في طبقة الخدمات، والرفض يُسجَّل في التدقيق، وإخفاء الأزرار مجرد تلميح. الجلسة تُربط بالدخول السحابي عبر اسم المستخدم، والوضع المحلي بلا دخول يعتمد على PIN فقط.


## Main Dependencies

- React Native: 0.79.4
- React: 19.0.0
- Expo: ~53.0.12
- Expo Router: ~5.1.0
- Supabase: ^2.50.0
- Other commonly used libraries:  
  - @expo/vector-icons  
  - react-native-paper  
  - react-native-calendars  
  - lottie-react-native  
  - react-native-webview  
  - and more

For a full list of dependencies, see [package.json](./package.json).

## Password Recovery Deep Link

Password reset emails return to the app using `pharmacyaccounts://reset-password`. Add this exact URL to the Supabase project's **Authentication → URL Configuration → Redirect URLs** allow list. The app's `pharmacyaccounts` scheme is configured in `app.json`; the dashboard allow-list is a one-time project setting outside this repository.

## Shared Drug Reference Catalog

The shared catalog is stored in `public.drug_catalog`, separate from pharmacy-owned `public.products` and local opening-stock/batch data. The table is read-only through the app for authenticated users; browsing or searching it never creates inventory. The app downloads catalog pages from Supabase and saves a device-local cache, so it works offline after the first successful sync. A new install needs connectivity for that first sync.

The supplied source is transformed by `python3 scripts/build-drug-catalog.py <source-zip>`. It selects only the normalized/modified trade-name fields (`trade_name_ar` and `trade_name_en`) and omits source-original names, prices, stock thresholds, quantities, dosing instructions, and indications. The current Supabase catalog contains 4,048 records. Generated JSON/CSV files are intentionally git-ignored because this GitHub repository is public; the reference data remains in Supabase and authenticated app caches. Adding an item requires a deliberate action and locally entered sale price, purchase cost, and positive actual opening quantity. Source packaging conversions are suggestions and require confirmation before saving.

## Pharmacy profile, permissions, and currency migration

`supabase/005_admin_permissions_yemeni_rial.sql` adds pharmacy logo metadata, per-user job titles and permission overrides, a separately allow-listed system-administrator table, and the Yemeni-rial default. It is a migration file only; it is not applied automatically. Review and apply it intentionally in Supabase before using the new cloud profile fields. The system-administrator table is intentionally not writable from the mobile client.

The app's pharmacy settings can store the selected logo locally for printing. Cross-device logo sharing requires a configured Supabase Storage bucket and upload flow; the local URI/data is not itself a cloud sync mechanism.

## Multi-cashbox Ledger

The cash screen tracks three separate local balances: **Daily**, **Pharmacy**, and **Bank/Exchange**. Existing cash transactions without a cashbox identifier remain visible in the Daily cashbox to preserve historical balances; the combined balance remains the sum of all three boxes. Opening balances can be recorded once before the first non-zero movement in that box. Receipts and payments are explicit voucher transactions, expenses are assigned to the selected box, and an inter-box transfer creates a balanced outgoing/incoming pair so it does not change total cash. Daily closing records expected cash, counted cash, and the difference without changing the ledger balance; it also closes an active shift when one exists, while still allowing a cashbox-only closing snapshot when no shift is open. The screen supports date, box, movement-type and text filters, plus PDF export of the visible ledger.

## Development Tools

- TypeScript: ~5.8.3
- ESLint: ^9.25.0
- @babel/core: ^7.25.2

## Contributing

1. Fork this repository
2. Create a new branch (`git checkout -b main`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## Repository and Data Safety

This GitHub repository is public. Do not commit pharmacy records, user accounts, credentials, API secrets, or generated drug-catalog data. Contact the repository owner for collaboration or visibility requests.

---

Feel free to add project screenshots, API documentation, feature descriptions, or any other information as needed.


## Username Sign-In

The mobile app accepts a username and password. A Supabase Edge Function resolves the username server-side and returns a Supabase Auth session; the username-resolution response does not disclose the matched email. When a Supabase Auth user has no `user_metadata.username`, the initial username is the email's local part (the characters before `@`). Set `user_metadata.username` in Supabase Auth to use a different unique username. Password recovery still asks for the registered email. The Edge Function requires its migration to be applied and is intentionally unauthenticated at the gateway because it authenticates the submitted password itself; it applies server-side failure rate limits.
