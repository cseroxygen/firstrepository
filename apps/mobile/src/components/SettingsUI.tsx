import React from 'react'
import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

export const Tokens = {
  spacing: 16,
  radiusCard: 16,
  radiusCtrl: 12,
  color(light: boolean) {
    return light ? {
      bg: '#F7F7F9', text: '#111', secondary: '#6B7280', border: '#E5E7EB', card: '#FFFFFF', primary: '#0A84FF'
    } : {
      bg: '#0B0F14', text: '#EAECEF', secondary: '#9AA3AF', border: '#1F2937', card: '#0F1520', primary: '#0A84FF'
    }
  }
}

export const SectionHeader: React.FC<{ title: string }> = ({ title }) => {
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  return (
    <Text style={{ color: c.secondary, marginHorizontal: Tokens.spacing, marginTop: Tokens.spacing, marginBottom: 8 }}>{title}</Text>
  )
}

type RowProps = { title: string, subtitle?: string, icon?: keyof typeof Ionicons.glyphMap, iconColor?: string, trailing?: React.ReactNode, onPress?: () => void, destructive?: boolean, chevron?: boolean }

export const SettingsRow: React.FC<RowProps> = ({ title, subtitle, icon, iconColor, trailing, onPress, destructive, chevron = true }) => {
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, { backgroundColor: c.card, opacity: pressed ? 0.98 : 1 }]} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
        {icon && <Ionicons name={icon} size={20} color={destructive ? '#DC2626' : (iconColor || c.secondary)} />}
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: destructive ? '#DC2626' : c.text }]}>{title}</Text>
          {!!subtitle && <Text style={[s.subtitle, { color: c.secondary }]}>{subtitle}</Text>}
        </View>
        {!!trailing && <View style={{ marginRight: 8 }}>{trailing}</View>}
        {chevron && <Ionicons name="chevron-forward" size={18} color={c.secondary} />}
      </View>
    </Pressable>
  )
}

export const DestructiveRow: React.FC<{ title: string, icon?: keyof typeof Ionicons.glyphMap, onPress?: () => void }> = ({ title, icon = 'arrow-back-outline', onPress }) => (
  <SettingsRow title={title} icon={icon} onPress={onPress} destructive chevron={false} />
)

export const Card: React.FC<{ children: React.ReactNode }>=({ children })=>{
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  return <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>
}

const s = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 44,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 13 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, margin: 16, padding: 16 }
})
