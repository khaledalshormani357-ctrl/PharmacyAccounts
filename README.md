# Welcome to OnSpace AI

Onspace AI empowers anyone to turn ideas into powerful AI applications in minutes—no coding required. Our free, no-code platform enables effortless creation of custom AI apps; simply describe your vision and our agentic AI handles the rest. The onspace-app, built with React Native and Expo, demonstrates this capability—integrating popular third-party libraries to deliver seamless cross-platform performance across iOS, Android, and Web environments.

## Getting Started

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

### 2. Start the Project

- Start the development server (choose your platform):

```bash
npm run start         # Start Expo development server
npm run android       # Launch Android emulator
npm run ios           # Launch iOS simulator
npm run web           # Start the web version
```

- Reset the project (clear cache, etc.):

```bash
npm run reset-project
```

### 3. Lint the Code

```bash
npm run lint
```

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
