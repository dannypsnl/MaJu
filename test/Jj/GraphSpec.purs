module Jj.GraphSpec (spec) where

import Prelude

import Jj.Graph (Change, layout)
import Test.Spec (Spec, describe, it)
import Test.Spec.Assertions (shouldEqual)

change :: String -> Array String -> Change
change id parents = { change: id, parents }

spec :: Spec Unit
spec = describe "Jj.Graph" do

  it "gives an empty log no lanes at all" do
    layout [] `shouldEqual` { width: 0, places: [] }

  it "puts a lone change in the first lane, going nowhere" do
    layout [ change "a" [] ] `shouldEqual`
      { width: 1
      , places: [ { column: 0, incoming: [], edges: [], through: [], elided: false } ]
      }

  it "keeps a chain in one lane" do
    layout [ change "a" [ "b" ], change "b" [ "c" ], change "c" [] ] `shouldEqual`
      { width: 1
      , places:
          [ { column: 0, incoming: [], edges: [ 0 ], through: [], elided: false }
          , { column: 0, incoming: [ 0 ], edges: [ 0 ], through: [], elided: false }
          , { column: 0, incoming: [ 0 ], edges: [], through: [], elided: false }
          ]
      }

  it "opens a lane for a second head and lets the first cross it" do
    layout [ change "a" [ "c" ], change "b" [ "c" ], change "c" [] ] `shouldEqual`
      { width: 2
      , places:
          [ { column: 0, incoming: [], edges: [ 0 ], through: [], elided: false }
          , { column: 1, incoming: [], edges: [ 1 ], through: [ 0 ], elided: false }
          , { column: 0, incoming: [ 0, 1 ], edges: [], through: [], elided: false }
          ]
      }

  it "gives every parent of a merge a lane of its own" do
    layout
      [ change "m" [ "p", "q", "r" ]
      , change "p" []
      , change "q" []
      , change "r" []
      ] `shouldEqual`
      { width: 3
      , places:
          [ { column: 0, incoming: [], edges: [ 0, 1, 2 ], through: [], elided: false }
          , { column: 0, incoming: [ 0 ], edges: [], through: [ 1, 2 ], elided: false }
          , { column: 1, incoming: [ 1 ], edges: [], through: [ 2 ], elided: false }
          , { column: 2, incoming: [ 2 ], edges: [], through: [], elided: false }
          ]
      }

  it "reuses a lane once the change it was waiting for has come up" do
    layout
      [ change "a" [ "c" ]
      , change "b" [ "d" ]
      , change "c" []
      , change "d" []
      , change "e" [ "f" ]
      , change "f" []
      ] `shouldEqual`
      { width: 2
      , places:
          [ { column: 0, incoming: [], edges: [ 0 ], through: [], elided: false }
          , { column: 1, incoming: [], edges: [ 1 ], through: [ 0 ], elided: false }
          , { column: 0, incoming: [ 0 ], edges: [], through: [ 1 ], elided: false }
          , { column: 1, incoming: [ 1 ], edges: [], through: [], elided: false }
          , { column: 0, incoming: [], edges: [ 0 ], through: [], elided: false }
          , { column: 0, incoming: [ 0 ], edges: [], through: [], elided: false }
          ]
      }

  it "marks a parent the log does not reach rather than giving it a lane" do
    layout [ change "a" [ "elsewhere" ] ] `shouldEqual`
      { width: 1
      , places: [ { column: 0, incoming: [], edges: [], through: [], elided: true } ]
      }

  it "marks a merge elided when only some of its parents are in the log" do
    layout [ change "m" [ "p", "elsewhere" ], change "p" [] ] `shouldEqual`
      { width: 1
      , places:
          [ { column: 0, incoming: [], edges: [ 0 ], through: [], elided: true }
          , { column: 0, incoming: [ 0 ], edges: [], through: [], elided: false }
          ]
      }
