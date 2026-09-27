import PageContainer from '../../components/UI/PageContainer'
import GlassCard from '../../components/UI/GlassCard'
import StatsCard from '../../components/UI/StatsCard'
import SearchBar from '../../components/UI/SearchBar'
import DataTable from '../../components/UI/DataTable'
import StatusBadge from '../../components/UI/StatusBadge'
import PrimaryButton from '../../components/UI/PrimaryButton'

export default function SuppliersPage() {
  const columns = [
    'Proveedor',
    'Contacto',
    'Balance',
    'Estado'
  ]

  const data = [
    [
      'Textiles Andinos',
      '3009871234',
      '$1.240.000',
      <StatusBadge status="Activo" />
    ],
    [
      'Moda Express',
      '3115552201',
      '$420.000',
      <StatusBadge status="Activo" />
    ],
    [
      'Distribuidora Denim',
      '3158894455',
      '$0',
      <StatusBadge status="Inactivo" />
    ]
  ]

  return (
    <PageContainer
      title="Proveedores"
      subtitle="Administra compras y relaciones comerciales"
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
          title="Proveedores Totales"
          value="62"
          icon="🏭"
          trend="+4 este mes"
        />

        <StatsCard
          title="Activos"
          value="49"
          icon="🟢"
        />

        <StatsCard
          title="Balance Pendiente"
          value="$8.2M"
          icon="💳"
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
          <SearchBar placeholder="Buscar proveedor..." />

          <PrimaryButton>
            + Agregar Proveedor
          </PrimaryButton>
        </div>

        <DataTable columns={columns} data={data} />
      </GlassCard>
    </PageContainer>
  )
}