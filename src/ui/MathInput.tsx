import React from 'react';

interface MathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  style?: React.CSSProperties;
}

export const MathInput: React.FC<MathInputProps> = ({ value, onChange, placeholder, className = '', multiline = false, style }) => {
  const isValid = React.useMemo(() => {
    try {
      // Test the formula using new Function
      // We pass common variables it might expect: t, b, m, ticks, f, v
      new Function('t', 'b', 'm', 'ticks', 'f', 'v', `return ${value}`);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  const baseStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px',
    paddingRight: '24px',
    background: '#1a1a24',
    color: '#ff3366',
    border: '1px solid rgba(255,51,102,0.3)',
    borderRadius: '4px',
    fontSize: '10px',
    fontFamily: 'monospace',
    outline: 'none',
    ...style
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    paddingRight: '24px',
    background: '#1e1e2e',
    color: 'white',
    border: '1px solid rgba(77,171,247,0.3)',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    outline: 'none',
    ...style
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {multiline ? (
        <textarea
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...baseStyle, height: '60px', resize: 'vertical' }}
        />
      ) : (
        <input
          type="text"
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
      <div 
        style={{ 
          position: 'absolute', 
          right: '8px', 
          top: '8px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}
        title={isValid ? 'Valid Formula' : 'Syntax Error'}
      >
        {isValid ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#40c057" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fa5252" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        )}
      </div>
    </div>
  );
};
