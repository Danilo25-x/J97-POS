import PageContainer from '../../components/UI/PageContainer'
import GlassCard from '../../components/UI/GlassCard'
import StatsCard from '../../components/UI/StatsCard'
import SearchBar from '../../components/UI/SearchBar'
import DataTable from '../../components/UI/DataTable'
import PrimaryButton from '../../components/UI/PrimaryButton'

function BillingStatus({ status }) {
  const styles = {
    Pagada: ['#DCFCE7', '#166534'],
    Pendiente: ['#FEF3C7', '#92400E'],
    Anulada: ['#FEE2E2', '#991B1B']
  }

  const [bg, color] = styles[status] || ['#E2E8F0', '#475569']

  return (
    <span
      style={{
        padding: '8px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: bg,
        color
      }}
    >
      {status}
    </span>
  )
}

export default function BillingPage() {
  const columns = [
    'Factura',
    'Cliente',
    'Monto',
    'Estado'
  ]

  const data = [
    [
      '#FAC-1001',
      'Juan Pérez',
      '$240.000',
      <BillingStatus status="Pagada" />
    ],
    [
      '#FAC-1002',
      'María Gómez',
      '$540.000',
      <BillingStatus status="Pendiente" />
    ],
    [
      '#FAC-1003',
      'Carlos Ruiz',
      '$120.000',
      <BillingStatus status="Anulada" />
    ]
  ]

  return (
    <PageContainer
      title="Facturación"
      subtitle="Gestiona comprobantes y facturas"
    >
      {/* KPI */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 20,
          marginBottom: 28
        }}
      >
        <StatsCard
          title="Facturas Hoy"
          value="24"
          icon="🧾"
          trend="+8%"
        />

        <StatsCard
          title="Ingresos Facturados"
          value="$6.8M"
          icon="💵"
        />

        <StatsCard
          title="Pendientes"
          value="5"
          icon="⏳"
        />
      </div>

      {/* Tabla */}
      <GlassCard>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 24
          }}
        >
          <SearchBar placeholder="Buscar factura..." />

          <PrimaryButton>
            + Nueva Factura
          </PrimaryButton>
        </div>

        <DataTable columns={columns} data={data} />
      </GlassCard>
    </PageContainer>
  )
}