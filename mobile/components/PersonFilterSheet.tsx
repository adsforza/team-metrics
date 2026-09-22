import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Card, Typography } from '../lib/theme';
import { useFilterStore } from '../store/filterStore';
import { useSyncStore } from '../store/syncStore';
import { visibleMembers, type MemberOption } from '../lib/personFilter';

// De 40 miembros solo ~12 tienen actividad real: 9 pasan los 200 issues, 3 estan
// entre 50 y 199, y los 28 restantes tienen entre 0 y 9. Mostrar los 40 hace lento
// el render y entierra a los relevantes, asi que arranca cortado en 12 y se expande
// a pedido. La busqueda siempre mira la lista completa.
const TOP_LIMIT = 12;

interface Props {
  visible: boolean;
  members: MemberOption[];
  onClose: () => void;
}

export function PersonFilterSheet({ visible, members, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { assignees, toggleAssignee, clearAssignees } = useFilterStore();
  const { recompute } = useSyncStore();

  const handleDone = () => {
    onClose();
    recompute();
    // Reset del estado local: sin esto, al reabrir la hoja seguis viendo la busqueda
    // anterior y la lista expandida, que no es lo que espera quien la vuelve a abrir.
    setQuery('');
    setShowAll(false);
  };

  const { shown, hidden, truncated } = visibleMembers(
    members,
    query,
    showAll ? 0 : TOP_LIMIT,
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // onRequestClose cubre el boton atras de Android; onDismiss cubre el gesto
      // de swipe-down en iOS, que es como se cierra naturalmente una pageSheet.
      // Sin los dos, cerrar deslizando deja el filtro aplicado sin recalcular.
      onRequestClose={handleDone}
      onDismiss={handleDone}
    >
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.title}>Personas</Text>
          <TouchableOpacity onPress={handleDone} style={s.doneBtn}>
            <Text style={s.doneBtnText}>Listo</Text>
          </TouchableOpacity>
        </View>

        <View style={s.searchWrap}>
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={`Buscar entre ${members.length} personas...`}
            placeholderTextColor={Colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <TouchableOpacity style={s.row} onPress={clearAssignees}>
          <Text style={Typography.body}>Todos</Text>
          {assignees.length === 0 && <Feather name="check" size={18} color={Colors.primary} />}
        </TouchableOpacity>

        <FlatList
          data={shown}
          keyExtractor={m => m.id}
          // La lista arranca en 12 filas, pero al expandir son 40: estos limites
          // evitan que el scroll se sienta pesado en gama baja.
          initialNumToRender={TOP_LIMIT}
          windowSize={5}
          renderItem={({ item }) => {
            const selected = assignees.includes(item.id);
            return (
              <TouchableOpacity style={s.row} onPress={() => toggleAssignee(item.id)}>
                <View style={s.nameWrap}>
                  <Text style={Typography.body} numberOfLines={1}>{item.name}</Text>
                  {item.issueCount != null && (
                    <Text style={s.count}>{item.issueCount}</Text>
                  )}
                </View>
                {selected && <Feather name="check" size={18} color={Colors.primary} />}
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            truncated ? (
              <TouchableOpacity style={s.moreBtn} onPress={() => setShowAll(true)}>
                <Text style={s.moreText}>
                  Ver las {hidden} restantes (con menos issues)
                </Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={<Text style={[Typography.bodyMuted, s.empty]}>Sin resultados</Text>}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  doneBtn: { padding: 6 },
  doneBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  searchWrap: { padding: 16 },
  searchInput: {
    ...Card.base,
    paddingVertical: 8,
    color: Colors.text,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { fontSize: 12, color: Colors.textSubtle },
  moreBtn: { paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  moreText: { fontSize: 13, color: Colors.primary },
  empty: { textAlign: 'center', marginTop: 24 },
});
