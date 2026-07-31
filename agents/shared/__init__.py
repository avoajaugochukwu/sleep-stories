"""Shared model-access layer for the sleep-stories agents.

Deliberately empty of re-exports: importing `shared` must not pull `shared.llm`
(and therefore the openai SDK) into the import graph, or the offline tests and
the health probe stop working without a key. Import the submodule you want.
"""
