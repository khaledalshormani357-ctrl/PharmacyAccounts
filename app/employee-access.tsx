import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Switch } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/contexts/ThemeContext';
import { getUsers, updateUser, User } from '@/services/database';
import { PERMISSION_GROUPS, ROLE_LABELS, getEffectivePermissions } from '@/services/employee-permissions';
import { useAlert } from '@/template';

export default function EmployeeAccessScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const selected = users.find(user => user.id === selectedId) || null;
  const colors = theme.colors;

  const load = useCallback(() => {
    const current = getUsers();
    setUsers(current);
    setSelectedId(previous => current.some(user => user.id === previous) ? previous : (current[0]?.id ?? null));
    if (current.length && selectedId == null) setDraft(getEffectivePermissions(current[0].role, current[0].permissions));
  }, [selectedId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const chooseEmployee = (user: User) => {
    setSelectedId(user.id);
    setDraft(getEffectivePermissions(user.role, user.permissions));
  };

  const setAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    PERMISSION_GROUPS.forEach(group => group.permissions.forEach(permission => { next[permission.id] = value; }));
    setDraft(next);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      updateUser(selected.id, { permissions: draft });
      setUsers(getUsers());
      await import('@/services/database').then(module => module.flushDatabaseWrites());
      showAlert('تم الحفظ', 'تم حفظ صلاحيات الموظف على هذا الجهاز.');
    } catch (error: any) {
      showAlert('تعذر الحفظ', error?.message || 'تعذر تأكيد حفظ الصلاحيات.');
    } finally {
      setSaving(false);
    }
  };

  const shareEmployeePackage = async () => {
    if (!selected) return;
    try {
      if (!FileSystem.documentDirectory) {
        showAlert('تعذر إنشاء الملف', 'مساحة الملفات المحلية غير متاحة.');
        return;
      }
      const packageData = {
        format: 'smart-pharmacy-employee',
        version: 1,
        created_at: new Date().toISOString(),
        employee: {
          username: selected.username,
          full_name: selected.full_name,
          job_title: selected.job_title || ROLE_LABELS[selected.role],
          role: selected.role,
          phone: selected.phone,
          permissions: getEffectivePermissions(selected.role, selected.permissions),
          active: selected.active,
        },
        security: 'لا يحتوي هذا الملف على كلمة المرور أو بصمتها. عيّن كلمة مرور محلياً عند إنشاء الحساب على الجهاز الآخر.',
      };
      const safeName = selected.username.replace(/[^a-zA-Z0-9_-]/g, '_');
      const uri = FileSystem.documentDirectory + 'employee-' + safeName + '.json';
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(packageData, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'مشاركة حزمة الموظف' });
      } else {
        showAlert('تم إنشاء الحزمة', 'تم حفظ ملف JSON في مساحة التطبيق، لكن قائمة المشاركة غير متاحة على هذا الجهاز.');
      }
    } catch (error: any) {
      showAlert('فشل التصدير', error?.message || 'تعذر إنشاء حزمة الموظف.');
    }
  };

  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 };
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ backgroundColor: colors.primary, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" /></TouchableOpacity>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>صلاحيات الموظفين</Text>
        <MaterialIcons name="admin-panel-settings" size={23} color="#FFFFFF" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
        <Text style={{ color: colors.textSecondary, textAlign: 'right', lineHeight: 21, marginBottom: 12 }}>
          اختر الموظف ثم اضبط الصلاحيات ضمن المجموعات الخمس. تُحفظ التعديلات محلياً، وتُستخدم الحزمة لنقل تعريف الموظف دون بيانات الدخول السرية.
        </Text>
        <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', marginBottom: 8 }}>الموظفون — ستة أدوار وظيفية</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
          {users.map(user => (
            <TouchableOpacity key={user.id} onPress={() => chooseEmployee(user)} style={{ minWidth: 130, borderRadius: 10, padding: 11, backgroundColor: selectedId === user.id ? colors.primary : colors.surface, borderWidth: 1, borderColor: selectedId === user.id ? colors.primary : colors.border }}>
              <Text style={{ color: selectedId === user.id ? '#FFFFFF' : colors.textPrimary, textAlign: 'right', fontWeight: '800' }}>{user.full_name}</Text>
              <Text style={{ color: selectedId === user.id ? '#FFFFFF' : colors.textSecondary, textAlign: 'right', fontSize: 11, marginTop: 4 }}>{ROLE_LABELS[user.role]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {!users.length ? <View style={card}><Text style={{ color: colors.textSecondary, textAlign: 'right' }}>لا يوجد موظفون بعد. أضف الموظفين من شاشة إدارة المستخدمين.</Text></View> : null}
        {selected ? <>
          <View style={[card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <TouchableOpacity onPress={() => setAll(true)}><Text style={{ color: colors.primary, fontWeight: '700' }}>تفعيل الكل</Text></TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'flex-end', marginHorizontal: 10 }}>
              <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>{selected.full_name}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>@{selected.username} · {ROLE_LABELS[selected.role]}</Text>
            </View>
            <TouchableOpacity onPress={() => setAll(false)}><Text style={{ color: colors.error, fontWeight: '700' }}>إلغاء الكل</Text></TouchableOpacity>
          </View>
          {PERMISSION_GROUPS.map(group => (
            <View key={group.id} style={card}>
              <Text style={{ color: colors.textPrimary, textAlign: 'right', fontWeight: '800', fontSize: 15, marginBottom: 8 }}>{group.title}</Text>
              {group.permissions.map(permission => (
                <View key={permission.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider }}>
                  <Switch value={draft[permission.id] === true} onValueChange={value => setDraft(previous => ({ ...previous, [permission.id]: value }))} trackColor={{ true: colors.primary }} />
                  <Text style={{ flex: 1, textAlign: 'right', color: colors.textPrimary, marginRight: 10 }}>{permission.label}</Text>
                </View>
              ))}
            </View>
          ))}
          <TouchableOpacity disabled={saving} onPress={save} style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10, opacity: saving ? 0.6 : 1 }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{saving ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={shareEmployeePackage} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 10, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="ios-share" size={20} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '800' }}>إنشاء ومشاركة حزمة الموظف (.json)</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textTertiary, textAlign: 'center', fontSize: 11, marginTop: 8 }}>تفتح قائمة المشاركة في أندرويد؛ اختر واتساب أو Bluetooth إذا كان متاحاً.</Text>
        </> : null}
      </ScrollView>
    </View>
  );
}
