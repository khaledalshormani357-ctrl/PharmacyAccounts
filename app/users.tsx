import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Modal, Switch } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { addUser, getUsers, updateUser, User, UserRole } from '@/services/database';
import { useAlert } from '@/template';

const ROLES: UserRole[] = ['ADMIN', 'PHARMACIST', 'CASHIER', 'STOREKEEPER', 'ACCOUNTANT'];
const ROLE_LABEL: Record<UserRole, string> = { ADMIN: 'مدير', PHARMACIST: 'صيدلي', CASHIER: 'كاشير', STOREKEEPER: 'أمين مستودع', ACCOUNTANT: 'محاسب' };

export default function UsersScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('CASHIER');
  const [phone, setPhone] = useState('');

  const load = useCallback(() => setUsers(getUsers()), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const reset = () => { setEditing(null); setUsername(''); setFullName(''); setPassword(''); setRole('CASHIER'); setPhone(''); };
  const openEdit = (user: User) => { setEditing(user); setUsername(user.username); setFullName(user.full_name); setPassword(''); setRole(user.role); setPhone(user.phone || ''); setShowForm(true); };
  const save = () => {
    if (!fullName.trim() || (!editing && (!username.trim() || password.length < 4))) { showAlert('تنبيه', editing ? 'أدخل الاسم الكامل' : 'أدخل الاسم وكلمة مرور من 4 أحرف على الأقل'); return; }
    if (editing) updateUser(editing.id, { full_name: fullName.trim(), role, phone: phone.trim() || null, password });
    else addUser({ username: username.trim(), full_name: fullName.trim(), password, role, phone: phone.trim() });
    setShowForm(false); reset(); load(); showAlert('تم', editing ? 'تم تحديث المستخدم' : 'تمت إضافة المستخدم');
  };
  const toggle = (user: User) => { updateUser(user.id, { active: !user.active }); load(); };
  const input = { height: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, paddingHorizontal: 10, color: theme.colors.textPrimary, textAlign: 'right' as const, backgroundColor: theme.colors.surface };

  return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
    <View style={{ backgroundColor: '#0052CC', paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => { reset(); setShowForm(true); }} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>+ مستخدم</Text></TouchableOpacity>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 17 }}>إدارة المستخدمين</Text>
        <TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-forward" size={23} color="#FFFFFF" /></TouchableOpacity>
      </View>
    </View>
    <FlatList data={users} keyExtractor={u => String(u.id)} contentContainerStyle={{ padding: 14 }} renderItem={({ item }) => <View style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 11, padding: 13, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Switch value={item.active} onValueChange={() => toggle(item)} trackColor={{ true: theme.colors.success }} />
        <View style={{ flex: 1, alignItems: 'flex-end', marginHorizontal: 10 }}><Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '800' }}>{item.full_name}</Text><Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>@{item.username} • {ROLE_LABEL[item.role]}</Text></View>
        <TouchableOpacity onPress={() => openEdit(item)}><MaterialIcons name="edit" size={20} color={theme.colors.primary} /></TouchableOpacity>
      </View>
      <Text style={{ color: item.active ? theme.colors.success : theme.colors.error, fontSize: 11, textAlign: 'right', marginTop: 7 }}>{item.active ? 'نشط ويمكنه تسجيل الدخول' : 'معطل'}</Text>
    </View>} ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.colors.textTertiary, padding: 40 }}>لا يوجد مستخدمون</Text>} />
    <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}><View style={{ backgroundColor: theme.colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: insets.bottom + 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}><TouchableOpacity onPress={() => setShowForm(false)}><Text style={{ color: theme.colors.textTertiary }}>إلغاء</Text></TouchableOpacity><Text style={{ fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary }}>{editing ? 'تعديل مستخدم' : 'مستخدم جديد'}</Text></View>
      {!editing && <TextInput style={[input, { marginBottom: 9 }]} value={username} onChangeText={setUsername} placeholder="اسم المستخدم" placeholderTextColor={theme.colors.textTertiary} autoCapitalize="none" />}
      <TextInput style={[input, { marginBottom: 9 }]} value={fullName} onChangeText={setFullName} placeholder="الاسم الكامل" placeholderTextColor={theme.colors.textTertiary} />
      <TextInput style={[input, { marginBottom: 9 }]} value={password} onChangeText={setPassword} placeholder={editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'} placeholderTextColor={theme.colors.textTertiary} secureTextEntry />
      <TextInput style={[input, { marginBottom: 9 }]} value={phone} onChangeText={setPhone} placeholder="رقم الهاتف (اختياري)" placeholderTextColor={theme.colors.textTertiary} keyboardType="phone-pad" />
      <Text style={{ color: theme.colors.textSecondary, textAlign: 'right', marginBottom: 6 }}>الصلاحية</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{ROLES.map(r => <TouchableOpacity key={r} onPress={() => setRole(r)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: role === r ? theme.colors.primary : theme.colors.surfaceAlt }}><Text style={{ color: role === r ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 12 }}>{ROLE_LABEL[r]}</Text></TouchableOpacity>)}</View>
      <TouchableOpacity onPress={save} style={{ backgroundColor: theme.colors.primary, borderRadius: 9, paddingVertical: 13, alignItems: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '800' }}>حفظ</Text></TouchableOpacity>
    </View></View></Modal>
  </View>;
}
