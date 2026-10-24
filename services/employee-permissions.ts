import { EmployeePermissionMap, UserRole } from '@/services/database';

export const PERMISSION_GROUPS = [
  { id: 'sales', title: 'المبيعات', permissions: [
    { id: 'sales.view', label: 'عرض المبيعات' },
    { id: 'sales.create', label: 'إنشاء فاتورة بيع' },
    { id: 'sales.print', label: 'طباعة ومشاركة الفواتير' },
    { id: 'sales.return', label: 'مرتجع بيع' },
    { id: 'sales.cancel', label: 'إلغاء فاتورة' },
  ]},
  { id: 'purchases', title: 'المشتريات والموردون', permissions: [
    { id: 'purchases.view', label: 'عرض المشتريات' },
    { id: 'purchases.create', label: 'تسجيل فاتورة شراء' },
    { id: 'purchases.return', label: 'مرتجع شراء' },
    { id: 'suppliers.manage', label: 'إدارة الموردين' },
    { id: 'suppliers.pay', label: 'تسجيل مدفوعات الموردين' },
  ]},
  { id: 'inventory', title: 'المخزون والأدوية', permissions: [
    { id: 'inventory.view', label: 'عرض المخزون والأدوية' },
    { id: 'inventory.edit', label: 'تعديل الأصناف والأسعار' },
    { id: 'inventory.adjust', label: 'الجرد والتسويات' },
    { id: 'inventory.opening', label: 'الأرصدة الافتتاحية' },
    { id: 'inventory.samples', label: 'العينات المجانية' },
    { id: 'inventory.expiry', label: 'رادار الصلاحية' },
  ]},
  { id: 'customers', title: 'العملاء والتحصيل', permissions: [
    { id: 'customers.view', label: 'عرض العملاء والأرصدة' },
    { id: 'customers.manage', label: 'إضافة وتعديل العملاء' },
    { id: 'customers.collect', label: 'تسجيل التحصيل' },
    { id: 'customers.credit', label: 'البيع الآجل' },
  ]},
  { id: 'finance', title: 'المالية والنظام', permissions: [
    { id: 'finance.reports', label: 'عرض التقارير المالية' },
    { id: 'finance.profit', label: 'رؤية الأرباح والتكلفة' },
    { id: 'finance.cash', label: 'إدارة الصندوق والمصروفات' },
    { id: 'system.users', label: 'إدارة الموظفين والصلاحيات' },
    { id: 'system.settings', label: 'إعدادات النظام' },
    { id: 'system.backup', label: 'النسخ والاستعادة والنقل' },
    { id: 'system.audit', label: 'سجل التدقيق وفحص البيانات' },
  ]},
] as const;

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'مدير النظام',
  MANAGER: 'مدير الصيدلية',
  PHARMACIST: 'صيدلي',
  CASHIER: 'كاشير',
  STOREKEEPER: 'أمين المستودع',
  ACCOUNTANT: 'محاسب',
};

const ALL_IDS = PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission.id));

const DEFAULTS: Record<UserRole, string[]> = {
  ADMIN: ALL_IDS,
  MANAGER: ALL_IDS.filter(id => !['system.users'].includes(id)),
  PHARMACIST: ['sales.view','sales.create','sales.print','sales.return','purchases.view','purchases.create','purchases.return','suppliers.manage','inventory.view','inventory.edit','inventory.adjust','inventory.opening','inventory.samples','inventory.expiry','customers.view','customers.manage','customers.collect','customers.credit','finance.reports'],
  CASHIER: ['sales.view','sales.create','sales.print','customers.view','customers.collect','finance.cash'],
  STOREKEEPER: ['inventory.view','inventory.adjust','inventory.opening','inventory.samples','inventory.expiry','purchases.view'],
  ACCOUNTANT: ['sales.view','sales.print','purchases.view','suppliers.manage','suppliers.pay','customers.view','customers.collect','finance.reports','finance.profit','finance.cash','system.audit'],
};

export function getDefaultPermissions(role: UserRole): EmployeePermissionMap {
  const allowed = new Set(DEFAULTS[role] || []);
  return Object.fromEntries(ALL_IDS.map(id => [id, allowed.has(id)]));
}

export function getEffectivePermissions(role: UserRole, overrides?: EmployeePermissionMap): EmployeePermissionMap {
  return { ...getDefaultPermissions(role), ...(overrides || {}) };
}

export function isPermissionAllowed(role: UserRole, permissionId: string, overrides?: EmployeePermissionMap): boolean {
  return getEffectivePermissions(role, overrides)[permissionId] === true;
}

export function getPermissionIds(): string[] {
  return [...ALL_IDS];
}
