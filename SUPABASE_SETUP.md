# إعداد Supabase لتطبيق Pharmacy Accounts

## 1. إنشاء الجداول

1. افتح مشروع Supabase.
2. اذهب إلى **SQL Editor** ثم **New query**.
3. انسخ محتوى `supabase/001_pharmacy_schema.sql` كاملًا.
4. اضغط **Run**.

هذا ينشئ أساسًا آمنًا للصيدلية، المستخدمين، الأصناف والوحدات، مع Row Level Security.

## 2. إعداد متغيرات التطبيق

أنشئ ملفًا باسم `.env.local` في جذر المشروع:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_publishable_or_anon_key
```

استخدم المفتاح العام فقط. لا تضع `service_role` أو كلمة مرور قاعدة البيانات داخل التطبيق أو GitHub.

## 3. إنشاء المدير الأول

1. من **Authentication > Users** أنشئ مستخدمًا بالبريد وكلمة المرور.
2. انسخ UUID الخاص بالمستخدم.
3. في SQL Editor شغّل:

```sql
insert into public.pharmacies (name, owner_name)
values ('اسم الصيدلية', 'اسم المالك')
returning id;
```

احتفظ بمعرّف الصيدلية، ثم شغّل:

```sql
insert into public.pharmacy_profiles (id, pharmacy_id, username, full_name, role)
values ('AUTH_USER_UUID', 'PHARMACY_UUID', 'admin', 'المدير', 'ADMIN');
```

استبدل القيم بين علامات الاقتباس بالقيم الفعلية.

## 4. سياسة الأمان

- المفتاح العام آمن للاستخدام داخل تطبيق الهاتف لأنه لا يتجاوز سياسات RLS.
- لا تستخدم `service_role` في Expo أو APK.
- كل مستخدم مرتبط بصيدلية واحدة عبر `pharmacy_profiles`.
- كل مستخدم يرى بيانات صيدليته فقط.
- إنشاء المستخدمين من داخل التطبيق يحتاج Edge Function تستخدم مفتاحًا سريًا؛ لن نضع هذا المفتاح في الهاتف.
