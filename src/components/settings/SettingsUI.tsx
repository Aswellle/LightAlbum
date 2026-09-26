/**
 * @file src/components/settings/SettingsUI.tsx
 * @description 设置页复用 UI 原语
 *
 * 导出：
 *   SettingRow      — 行容器（label + description + 右侧控件）
 *   SettingSection  — 分区标题 + 分割线
 *   ToggleSwitch    — 开关控件
 *   SegmentedControl — 分段选择器（主题/布局切换）
 *   SettingSelect   — 下拉选择
 *   SettingNote     — 灰色辅助说明文字
 */

import { memo } from 'react'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  SettingSection — 分区标题
// ─────────────────────────────────────────────────────────

interface SettingSectionProps {
  title:    string
  icon?:    IconName
  children: React.ReactNode
}

export function SettingSection({ title, icon, children }: SettingSectionProps) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <div style={{
        display:       'flex',
        alignItems:    'center',
        gap:           '7px',
        marginBottom:  '14px',
        paddingBottom: '8px',
        borderBottom:  '1px solid var(--la-divider)',
      }}>
        {icon && (
          <Icon name={icon} size={15} color="var(--la-text-secondary)" strokeWidth={1.5} />
        )}
        <h2 style={{
          fontSize:      'var(--la-text-sm)',
          fontWeight:    'var(--la-weight-semibold)' as unknown as number,
          color:         'var(--la-text-secondary)',
          margin:        0,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {title}
        </h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {children}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────
//  SettingRow — 设置行
// ─────────────────────────────────────────────────────────

interface SettingRowProps {
  label:        string
  description?: string
  children:     React.ReactNode
  /** 控件宽度（右侧区域），默认 auto */
  controlWidth?: number | string
}

export function SettingRow({ label, description, children, controlWidth = 'auto' }: SettingRowProps) {
  return (
    <div style={{
      display:        'flex',
      alignItems:     description ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      gap:            '24px',
      padding:        '10px 0',
      borderBottom:   '1px solid var(--la-divider)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize:  'var(--la-text-sm)',
          color:     'var(--la-text-primary)',
          fontWeight: 'var(--la-weight-medium)' as unknown as number,
        }}>
          {label}
        </div>
        {description && (
          <div style={{
            fontSize:   'var(--la-text-xs)',
            color:      'var(--la-text-secondary)',
            marginTop:  '3px',
            lineHeight: 'var(--la-leading-normal)',
          }}>
            {description}
          </div>
        )}
      </div>
      <div style={{
        flexShrink: 0,
        width:      controlWidth,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}>
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  ToggleSwitch
// ─────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  checked:   boolean
  onChange:  (v: boolean) => void
  disabled?: boolean
  label?:    string
}

export const ToggleSwitch = memo(function ToggleSwitch({
  checked, onChange, disabled, label,
}: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        position:        'relative',
        width:           '38px',
        height:          '22px',
        borderRadius:    '11px',
        backgroundColor: checked ? 'var(--la-accent)' : 'var(--la-bg-overlay)',
        border:          `1px solid ${checked ? 'var(--la-accent)' : 'var(--la-border)'}`,
        cursor:          disabled ? 'not-allowed' : 'default',
        opacity:         disabled ? 0.45 : 1,
        transition:      'background-color 180ms ease, border-color 180ms ease',
        padding:         0,
        flexShrink:      0,
      }}
    >
      <div style={{
        position:        'absolute',
        top:             '2px',
        left:            checked ? '17px' : '2px',
        width:           '16px',
        height:          '16px',
        borderRadius:    '50%',
        backgroundColor: '#fff',
        boxShadow:       '0 1px 3px rgba(0,0,0,0.3)',
        transition:      'left 180ms ease',
      }} />
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  SegmentedControl
// ─────────────────────────────────────────────────────────

interface SegmentOption<T extends string> {
  value:  T
  label:  string
  icon?:  IconName
  title?: string
}

interface SegmentedControlProps<T extends string> {
  options:  SegmentOption<T>[]
  value:    T
  onChange: (v: T) => void
}

export function SegmentedControl<T extends string>({
  options, value, onChange,
}: SegmentedControlProps<T>) {
  return (
    <div style={{
      display:         'flex',
      backgroundColor: 'var(--la-bg-overlay)',
      borderRadius:    'var(--la-radius-md)',
      padding:         '2px',
      gap:             '1px',
    }}>
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.title ?? opt.label}
            aria-pressed={isActive}
            style={{
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             '5px',
              padding:         '5px 12px',
              height:          '28px',
              borderRadius:    '5px',
              backgroundColor: isActive ? 'var(--la-bg-raised)' : 'transparent',
              border:          'none',
              color:           isActive ? 'var(--la-text-primary)' : 'var(--la-text-secondary)',
              fontSize:        'var(--la-text-sm)',
              fontWeight:      (isActive ? 'var(--la-weight-semibold)' : 'var(--la-weight-medium)') as unknown as number,
              cursor:          'default',
              boxShadow:       isActive ? 'var(--la-shadow-sm)' : 'none',
              transition:      'all 120ms ease',
              whiteSpace:      'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--la-text-primary)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--la-text-secondary)'
              }
            }}
          >
            {opt.icon && (
              <Icon
                name={opt.icon}
                size={14}
                color={isActive ? 'var(--la-accent-text)' : 'currentColor'}
              />
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  SettingSelect
// ─────────────────────────────────────────────────────────

interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SettingSelectProps<T extends string> {
  options:   SelectOption<T>[]
  value:     T
  onChange:  (v: T) => void
  width?:    number
  disabled?: boolean
}

export function SettingSelect<T extends string>({
  options, value, onChange, width = 160, disabled,
}: SettingSelectProps<T>) {
  return (
    <div style={{ position: 'relative', width, flexShrink: 0 }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        style={{
          width:           '100%',
          height:          '30px',
          padding:         '0 28px 0 10px',
          fontSize:        'var(--la-text-sm)',
          fontWeight:      'var(--la-weight-medium)' as unknown as number,
          color:           disabled ? 'var(--la-text-disabled)' : 'var(--la-text-primary)',
          backgroundColor: 'var(--la-bg-overlay)',
          border:          '1px solid var(--la-border)',
          borderRadius:    'var(--la-radius-md)',
          cursor:          disabled ? 'not-allowed' : 'default',
          appearance:      'none',
          outline:         'none',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div style={{
        position:      'absolute',
        right:         '8px',
        top:           '50%',
        transform:     'translateY(-50%)',
        pointerEvents: 'none',
      }}>
        <Icon name="chevron-down" size={14} color="var(--la-text-secondary)" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  SettingNote — 辅助说明文字（段落级）
// ─────────────────────────────────────────────────────────

interface SettingNoteProps {
  children: React.ReactNode
  variant?: 'info' | 'warning'
}

export function SettingNote({ children, variant = 'info' }: SettingNoteProps) {
  return (
    <div style={{
      display:         'flex',
      alignItems:      'flex-start',
      gap:             '7px',
      padding:         '8px 10px',
      borderRadius:    'var(--la-radius-md)',
      backgroundColor: variant === 'warning'
        ? 'var(--la-warning-subtle)'
        : 'var(--la-bg-overlay)',
      border:          '1px solid transparent',
      marginTop:       '4px',
    }}>
      <Icon
        name="info"
        size={14}
        color={variant === 'warning' ? 'var(--la-warning)' : 'var(--la-text-secondary)'}
        style={{ marginTop: '1px', flexShrink: 0 }}
      />
      <span style={{
        fontSize:   'var(--la-text-xs)',
        color:      variant === 'warning' ? 'var(--la-warning)' : 'var(--la-text-secondary)',
        lineHeight: 'var(--la-leading-normal)',
      }}>
        {children}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  ActionButton — 设置内使用的操作按钮
// ─────────────────────────────────────────────────────────

interface ActionButtonProps {
  onClick:   () => void
  label:     string
  icon?:     IconName
  variant?:  'default' | 'danger'
  loading?:  boolean
  disabled?: boolean
}

export const ActionButton = memo(function ActionButton({
  onClick, label, icon, variant = 'default', loading, disabled,
}: ActionButtonProps) {
  const isDanger  = variant === 'danger'
  const isBlocked = !!disabled && !loading
  const baseColor = isBlocked
    ? 'var(--la-text-disabled)'
    : isDanger ? 'var(--la-danger-text)' : 'var(--la-text-secondary)'
  const baseBg     = isDanger ? 'var(--la-danger-subtle)' : 'var(--la-bg-overlay)'
  const baseBorder = isDanger ? 'transparent' : 'var(--la-border)'
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             '6px',
        height:          '30px',
        padding:         '0 12px',
        borderRadius:    'var(--la-radius-md)',
        backgroundColor: baseBg,
        border:          `1px solid ${baseBorder}`,
        color:           baseColor,
        fontSize:        'var(--la-text-sm)',
        fontWeight:      'var(--la-weight-medium)' as unknown as number,
        cursor:          (disabled || loading) ? 'not-allowed' : 'default',
        transition:      'all 100ms ease',
        whiteSpace:      'nowrap',
        flexShrink:      0,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          if (isDanger) {
            e.currentTarget.style.borderColor = 'var(--la-danger)'
          } else {
            e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
            e.currentTarget.style.color = 'var(--la-text-primary)'
          }
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = baseBg
        e.currentTarget.style.borderColor = baseBorder
        e.currentTarget.style.color = baseColor
      }}
    >
      {loading ? (
        <div style={{
          width:  12,
          height: 12,
          border: '1.5px solid currentColor',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'la-spin 0.7s linear infinite',
          flexShrink: 0,
        }} />
      ) : icon ? (
        <Icon name={icon} size={14} color="currentColor" />
      ) : null}
      {label}
    </button>
  )
})
