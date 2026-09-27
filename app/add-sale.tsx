// Smart Pharmacy ERP — Add Sale (legacy bridge → redirects to POS)
import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function AddSaleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  useEffect(() => {
    router.replace({ pathname: '/pos', params: { type: params.type } });
  }, []);
  return null;
}
