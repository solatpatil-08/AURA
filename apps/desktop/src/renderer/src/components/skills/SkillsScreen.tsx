import React, { useState } from 'react'
import { useAura } from '../../context/AuraContext'
import {
  Brain,
  Mic,
  Box,
  ShieldCheck,
  Database,
  Sparkles,
  CheckCircle2,
  Lock
} from 'lucide-react'

interface SkillCategory {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ style?: React.CSSProperties; className?: string }>
  accent: string
  status: 'active' | 'ready' | 'verified'
  metrics: { label: string; value: string }[]
  capabilities: string[]
  securityGuardrail: string
}

export const SkillsScreen: React.FC = () => {
  const { systemStatus, settings } = useAura()
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'reasoning' | 'voice' | 'avatar' | 'security'>('all')

  const skills: SkillCategory[] = [
    {
      id: 'neural-reasoning',
      title: 'Local Neural Reasoning',
      description: 'Zero-cloud autonomous language reasoning powered by quantized local LLMs via Ollama.',
      icon: Brain,
      accent: '#7f5af0',
      status: systemStatus.ollama === 'connected' ? 'active' : 'ready',
      metrics: [
        { label: 'Active Model', value: settings.modelName },
        { label: 'Runtime', value: 'Ollama Engine' },
        { label: 'Connection', value: systemStatus.ollama === 'connected' ? 'Connected' : 'Standby' }
      ],
      capabilities: [
        'Deterministic multi-step planning and intent decomposition',
        'Strict JSON function-calling schema enforcement',
        'Streaming thought-token reasoning with zero remote telemetry',
        'Context preservation across continuous user dialogue'
      ],
      securityGuardrail: 'Zero remote API calls. All prompts and reasoning remain completely within localhost.'
    },
    {
      id: '3d-avatar',
      title: '3D VRM Character & Viseme Engine',
      description: 'Hardware-accelerated 3D companion rendered via Three.js with real-time lip-sync visemes.',
      icon: Box,
      accent: '#00f2fe',
      status: 'active',
      metrics: [
        { label: 'Graphics API', value: 'Hardware WebGL' },
        { label: 'Framework', value: 'Three.js r186' },
        { label: 'Standard', value: '@pixiv/three-vrm v3.5' }
      ],
      capabilities: [
        'Procedural humanoid animation: natural breathing, head sway, and blinking',
        'Audio-driven phoneme viseme morphs (aa, ih, oh) via Web Audio API',
        'Adaptive ambient state lighting and particle atmospheric effects',
        'Custom local VRM model loading with humanoid bone validation'
      ],
      securityGuardrail: 'Strictly local asset loading. External 3D character downloads are forbidden.'
    },
    {
      id: 'speech-ai',
      title: 'Offline Speech AI & Voice Engine',
      description: 'End-to-end local speech recognition and neural synthesis without paid or remote APIs.',
      icon: Mic,
      accent: '#2cb67d',
      status: systemStatus.voiceEngineStatus?.stt?.available ? 'active' : 'ready',
      metrics: [
        { label: 'STT Engine', value: 'faster-whisper (CPU INT8)' },
        { label: 'TTS Engine', value: 'Piper Neural TTS' },
        { label: 'Mute Status', value: settings.voiceOutputEnabled ? 'Voice On' : 'Voice Muted' }
      ],
      capabilities: [
        'Offline multilingual transcription with push-to-talk recording',
        'Instant voice interruption and speech playback termination',
        'Clean text filtering: strips code blocks and JSON before synthesis',
        'Dynamic frequency analysis for companion mouth sync'
      ],
      securityGuardrail: 'Zero hidden recording. Audio is buffered temporarily in RAM and destroyed post-synthesis.'
    },
    {
      id: 'sandbox-actions',
      title: 'Sandboxed Tools & Human Confirmation Gate',
      description: 'Controlled system interactions governed by strict path-jailing and approval gates.',
      icon: ShieldCheck,
      accent: '#ff8906',
      status: 'verified',
      metrics: [
        { label: 'Policy', value: settings.toolExecutionPolicy },
        { label: 'Workspace Jail', value: settings.workspacePath ? 'Enforced' : 'Active' },
        { label: 'Gate Mechanism', value: 'Interactive Modal' }
      ],
      capabilities: [
        'Path-jail containment preventing any path traversal outside workspace',
        'Interactive diff preview before any file modification is committed',
        'Granular task orchestration with rollback recovery checkpoints',
        'Audit logging to local SQLite database with verifiable timestamps'
      ],
      securityGuardrail: 'No destructive file or process action occurs without explicit human approval.'
    },
    {
      id: 'persistent-memory',
      title: 'Workstation Memory & Context Recall',
      description: 'Structured episodic and semantic knowledge preservation across user sessions.',
      icon: Database,
      accent: '#4facfe',
      status: 'active',
      metrics: [
        { label: 'Storage', value: 'Local SQLite' },
        { label: 'Encryption', value: 'Host OS Sandboxed' },
        { label: 'User Controls', value: 'Full CRUD & Pin' }
      ],
      capabilities: [
        'Automatic preference, instruction, and project context extraction',
        'Semantic similarity recall for relevant conversation enrichment',
        'Dedicated memory management dashboard with search and deletion',
        'Session lifecycle management with archived conversation exports'
      ],
      securityGuardrail: 'User has unilateral control. Any memory can be reviewed, edited, or purged instantly.'
    }
  ]

  const filteredSkills = skills.filter((s) => {
    if (selectedFilter === 'reasoning') return s.id === 'neural-reasoning'
    if (selectedFilter === 'voice') return s.id === 'speech-ai'
    if (selectedFilter === 'avatar') return s.id === '3d-avatar'
    if (selectedFilter === 'security') return s.id === 'sandbox-actions' || s.id === 'persistent-memory'
    return true
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        padding: '24px 32px',
        gap: '24px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(127, 90, 240, 0.08) 0%, rgba(8, 10, 15, 0) 70%)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(0, 242, 254, 0.1)',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#00f2fe'
              }}
            >
              <Sparkles style={{ width: '18px', height: '18px' }} />
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Local Capabilities & Skill Matrix
            </h2>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '640px', lineHeight: 1.5 }}>
            AURA operates as a sovereign, local-first intelligence companion. Every skill is executed entirely on your
            local workstation with verifiable privacy, sandboxed execution, and human confirmation security gates.
          </p>
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', background: 'rgba(255, 255, 255, 0.04)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          {[
            { id: 'all', label: 'All Skills' },
            { id: 'reasoning', label: 'Reasoning' },
            { id: 'voice', label: 'Voice AI' },
            { id: 'avatar', label: '3D Companion' },
            { id: 'security', label: 'Security & Memory' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedFilter(tab.id as typeof selectedFilter)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                color: selectedFilter === tab.id ? '#00f2fe' : 'var(--text-muted)',
                background: selectedFilter === tab.id ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                border: selectedFilter === tab.id ? '1px solid rgba(0, 242, 254, 0.3)' : '1px solid transparent',
                transition: 'all 150ms ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Skill Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px'
        }}
      >
        {filteredSkills.map((skill) => {
          const IconComponent = skill.icon
          return (
            <div
              key={skill.id}
              className="glass-panel"
              style={{
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid var(--border-subtle)',
                transition: 'transform 200ms ease, border-color 200ms ease'
              }}
            >
              {/* Top Accent Line */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '2px',
                  background: `linear-gradient(90deg, ${skill.accent}, transparent)`
                }}
              />

              {/* Title & Badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: `${skill.accent}15`,
                      border: `1px solid ${skill.accent}40`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: skill.accent
                    }}
                  >
                    <IconComponent style={{ width: '20px', height: '20px' }} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{skill.title}</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{skill.description}</p>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background:
                      skill.status === 'active'
                        ? 'rgba(44, 182, 125, 0.15)'
                        : skill.status === 'verified'
                          ? 'rgba(0, 242, 254, 0.15)'
                          : 'rgba(255, 255, 255, 0.06)',
                    color:
                      skill.status === 'active'
                        ? '#2cb67d'
                        : skill.status === 'verified'
                          ? '#00f2fe'
                          : 'var(--text-secondary)',
                    border: `1px solid ${
                      skill.status === 'active'
                        ? 'rgba(44, 182, 125, 0.3)'
                        : skill.status === 'verified'
                          ? 'rgba(0, 242, 254, 0.3)'
                          : 'rgba(255, 255, 255, 0.1)'
                    }`
                  }}
                >
                  {skill.status}
                </span>
              </div>

              {/* Metrics Pill Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.04)'
                }}
              >
                {skill.metrics.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      {m.label}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                      {m.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Capabilities List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Core Capabilities
                </span>
                {skill.capabilities.map((cap, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    <CheckCircle2 style={{ width: '13px', height: '13px', color: skill.accent, marginTop: '2px', flexShrink: 0 }} />
                    <span>{cap}</span>
                  </div>
                ))}
              </div>

              {/* Security Guardrail Card */}
              <div
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '11px',
                  color: 'var(--text-muted)'
                }}
              >
                <Lock style={{ width: '12px', height: '12px', color: '#00f2fe', flexShrink: 0 }} />
                <span>{skill.securityGuardrail}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
