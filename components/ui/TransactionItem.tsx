// Smart Pharmacy ERP — TransactionItem Component
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency, getTransactionTypeLabel } from '@/constants/i18n';

interface Transaction {
  id: number; type: string; amount: number; date: string;
  customer_id: number | null; supplier_id: number | null;
  customer_name?: string; supplier_name?: string;
  note: string | null; invoice_number: string | null;
  discount: number; amount_paid: number; created_at: string;
}

interface TransactionItemRowProps {
  transaction: Transaction;
  onPress?: () => void;
  onLongPress?: () => void;
}

export function TransactionItemRow({ transaction, onPress, onLongPress }: TransactionItemRowProps) {
  const { theme } = useTheme();

  const typeColors: Record<string, string> = {
    cash_sale: theme.colors.income,
    credit_sale: theme.colors.credit,
    collection: theme.colors.secondary,
    expense: theme.colors.expense,
    purchase: theme.colors.purple,
    payment: theme.colors.success,
    cash: theme.colors.income,
    credit: theme.colors.credit,
  };

  const color = typeColors[transaction.type] || theme.colors.textSecondary;
  const label = getTransactionTypeLabel(transaction.type);
  const name = transaction.customer_name || transaction.supplier_name || label;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color }}>{formatCurrency(transaction.amount)}</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary }}>{name}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>{transaction.date}</Text>
          <View style={{ backgroundColor: color + '15', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color }}>{label}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default TransactionItemRow;
