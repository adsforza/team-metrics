import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Card, Typography } from '../lib/theme';
import { useFilterStore } from '../store/filterStore';
import { useSyncStore } from '../store/syncStore';
import { filterMembers, type MemberOption } from '../lib/personFilter';

interface Props {
  visible: boolean;
  members: MemberOption[];
  onClose: () => void;
}

export function PersonFilterSheet({ visible, members, onClose }: Props) {
  const [query, setQuery] = useState('');
  const { assignees, toggleAssignee, clearAssignees } = useFilterStore();
  const { recompute } = useSyncStore();

  const handleDone = () => {
    onClose();
    recompute();
  };

  const filtered = filterMembers(members, query);

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
            placeholder="Buscar por nombre..."
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
          data={filtered}
          keyExtractor={m => m.id}
          renderItem={({ item }) => {
            const selected = assignees.includes(item.id);
            return (
              <TouchableOpacity style={s.row} onPress={() => toggleAssignee(item.id)}>
                <Text style={Typography.body}>{item.name}</Text>
                {selected && <Feather name="check" size={18} color={Colors.primary} />}
              </TouchableOpacity>
            );
          }}
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
  empty: { textAlign: 'center', marginTop: 24 },
});
