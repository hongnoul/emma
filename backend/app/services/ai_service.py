"""AI service abstraction.

Mock/template implementations today. Each method documents the OpenAI call
that will replace it. No API key is required to run the prototype.
"""
from __future__ import annotations

from functools import lru_cache

from ..models.schemas import Edge, Node, PathStep


class AIService:
    """Swap this class for an OpenAI-backed implementation later.

    TODO(openai): implement with the Responses API. Suggested mapping:
      extract_entities            -> structured output over paper/abstract text
      extract_relationships       -> structured output producing Edge dicts (then judged by DecisionService)
      explain_connection          -> plain-language narration of a graph path, citing edge ids
      summarize_evidence          -> digest of supporting + contradictory evidence for one edge
      generate_research_opportunities -> opportunity cards grounded in graph context
    """

    def extract_entities(self, text: str) -> list[dict]:
        # TODO(openai): entity extraction. Mock returns nothing.
        return []

    def extract_relationships(self, text: str) -> list[dict]:
        # TODO(openai): relationship extraction into the Edge schema.
        return []

    def explain_connection(self, source: Node, target: Node,
                           path: list[PathStep], evidence: list[Edge]) -> str:
        # TODO(openai): replace template with a model-written narrative that
        # cites each edge id and clearly separates known / inferred / uncertain.
        if not path:
            return (f"No supported route between {source.name} and {target.name} was found in the "
                    f"current demo graph. This means Emmatics has no evidence chain to offer, not "
                    f"that none exists. The next step would be expanding coverage of both diseases.")
        hops = " → ".join(st.node.name for st in path)
        inferred_n = sum(1 for e in evidence if e.provenance == "inferred")
        contra = [e.id for e in evidence if e.contradictory_evidence]
        txt = (f"{source.name} connects to {target.name} through the route: {hops}. "
               f"The chain uses {len(evidence)} relationships, of which {inferred_n} are Emmatics-inferred "
               f"rather than curated. Inferred links are hypotheses with calibrated probabilities, "
               f"not established biology.")
        if contra:
            txt += f" Contradictory evidence is on record for: {', '.join(contra)}. Review it before acting."
        return txt + " [Template explanation from demo data; OpenAI narration will replace this.]"

    def summarize_evidence(self, edge: Edge) -> str:
        # TODO(openai): summarize edge.state + publications.
        return edge.state or edge.description

    def generate_research_opportunities(self, context: dict) -> list[dict]:
        # TODO(openai): generate opportunity cards. Mock handled in atlas.opportunities().
        return []

    def suggest_next_step(self, disease: Node, other: Node, asset: Node) -> str:
        # TODO(openai): tailored next-step suggestion.
        return (f"Evaluate whether '{asset.name}' could be informative for {disease.name}: compare "
                f"phenotype definitions and outcome measures with {other.name}, then seek expert "
                f"review of mechanistic comparability before any shared effort.")


@lru_cache(maxsize=1)
def get_ai_service() -> AIService:
    return AIService()
