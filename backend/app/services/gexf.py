"""GEXF export: serialize the Emmatics graph for Gephi desktop.

GEXF is Gephi's native format. Node type and provenance become Gephi
attributes so they can drive partition coloring and filters; p(valid)
becomes edge weight so Gephi's appearance/filter panels can rank edges.
"""
from __future__ import annotations

from xml.sax.saxutils import escape, quoteattr

from .graph_store import GraphStore

# Mirror of the frontend NODE_COLORS palette (r, g, b)
_COLORS = {
    "Disease": (220, 38, 38), "Gene": (37, 99, 235), "Variant": (96, 165, 250),
    "Phenotype": (217, 119, 6), "Mechanism": (124, 58, 237), "Pathway": (147, 51, 234),
    "Publication": (100, 116, 139), "ClinicalTrial": (5, 150, 105),
    "Researcher": (8, 145, 178), "PatientOrganization": (219, 39, 119),
    "ResearchAsset": (77, 124, 15),
}


def to_gexf(store: GraphStore) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" version="1.3">',
        '  <meta><creator>Emmatics (synthetic demo data)</creator>'
        '<description>All nodes and edges are demonstration data.</description></meta>',
        '  <graph defaultedgetype="directed">',
        '    <attributes class="node">',
        '      <attribute id="type" title="type" type="string"/>',
        '      <attribute id="identifier" title="identifier" type="string"/>',
        '    </attributes>',
        '    <attributes class="edge">',
        '      <attribute id="rel_type" title="rel_type" type="string"/>',
        '      <attribute id="provenance" title="provenance" type="string"/>',
        '      <attribute id="edge_valid" title="p_valid" type="float"/>',
        '      <attribute id="contradicted" title="p_contradicted" type="float"/>',
        '      <attribute id="source_db" title="source_db" type="string"/>',
        '    </attributes>',
        '    <nodes>',
    ]
    for n in store.nodes.values():
        r, g, b = _COLORS.get(n.type, (153, 153, 153))
        lines.append(
            f'      <node id={quoteattr(n.id)} label={quoteattr(n.name)}>'
            f'<attvalues><attvalue for="type" value={quoteattr(n.type)}/>'
            f'<attvalue for="identifier" value={quoteattr(n.identifier or "")}/></attvalues>'
            f'<viz:color r="{r}" g="{g}" b="{b}"/>'
            f'<viz:size value="{20 if n.type == "Disease" else 10}"/></node>'
        )
    lines.append('    </nodes>')
    lines.append('    <edges>')
    for e in store.edges.values():
        attrs = [
            f'<attvalue for="rel_type" value={quoteattr(e.rel_type)}/>',
            f'<attvalue for="provenance" value={quoteattr(e.provenance)}/>',
            f'<attvalue for="source_db" value={quoteattr(e.source_db)}/>',
        ]
        if e.edge_valid is not None:
            attrs.append(f'<attvalue for="edge_valid" value="{e.edge_valid}"/>')
        if e.contradicted is not None:
            attrs.append(f'<attvalue for="contradicted" value="{e.contradicted}"/>')
        weight = e.edge_valid if e.edge_valid is not None else 1.0
        lines.append(
            f'      <edge id={quoteattr(e.id)} source={quoteattr(e.source)} '
            f'target={quoteattr(e.target)} label={quoteattr(e.rel_type)} weight="{weight}">'
            f'<attvalues>{"".join(attrs)}</attvalues></edge>'
        )
    lines += ['    </edges>', '  </graph>', '</gexf>']
    return "\n".join(lines)
