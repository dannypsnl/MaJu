module Jj.Graph
  ( Change
  , Layout
  , Place
  , layout
  )
  where

import Prelude

import Data.Array (catMaybes, drop, elem, filter, findIndex, foldl, head, length, mapWithIndex, null, snoc, updateAt)
import Data.Maybe (Maybe(..), fromMaybe, isJust, isNothing)
import Data.Set as Set

type Change =
  { change :: String
  , parents :: Array String
  }

type Place =
  { column :: Int
  , incoming :: Array Int
  , edges :: Array Int
  , through :: Array Int
  , elided :: Boolean
  }

type Layout =
  { width :: Int
  , places :: Array Place
  }

type Lanes = Array (Maybe String)

occupy :: Int -> Maybe String -> Lanes -> Lanes
occupy at held lanes = fromMaybe (snoc lanes held) (updateAt at held lanes)

free :: Lanes -> Int
free lanes = fromMaybe (length lanes) (findIndex isNothing lanes)

waiting :: String -> Lanes -> Array Int
waiting id lanes =
  catMaybes (mapWithIndex (\at held -> if held == Just id then Just at else Nothing) lanes)

type Walk = { lanes :: Lanes, places :: Array Place }

layout :: Array Change -> Layout
layout changes = { width: widthOf places, places }
  where
  places = (foldl step { lanes: [], places: [] } changes).places

  known = Set.fromFoldable (map _.change changes)

  step :: Walk -> Change -> Walk
  step walk change = walk { lanes = leaving, places = snoc walk.places place }
    where
    incoming = waiting change.change walk.lanes
    column = fromMaybe (free walk.lanes) (head incoming)
    cleared = foldl (\lanes at -> occupy at Nothing lanes) walk.lanes incoming

    visible = filter (\parent -> Set.member parent known) change.parents
    kept = occupy column (head visible) cleared
    forked = foldl fork { lanes: kept, at: [] } (drop 1 visible)
    leaving = forked.lanes

    place =
      { column
      , incoming
      , edges: (if null visible then [] else [ column ]) <> forked.at
      , through: catMaybes
          ( mapWithIndex
              (\at held -> if isJust held && at /= column && not (elem at incoming) then Just at else Nothing)
              walk.lanes
          )
      , elided: length visible < length change.parents
      }

  fork state parent = case findIndex (_ == Just parent) state.lanes of
    Just at -> state { at = snoc state.at at }
    Nothing ->
      let
        at = free state.lanes
      in
        { lanes: occupy at (Just parent) state.lanes, at: snoc state.at at }

widthOf :: Array Place -> Int
widthOf places
  | null places = 0
  | otherwise = 1 + foldl max 0 (places >>= touches)
      where
      touches place = [ place.column ] <> place.incoming <> place.edges <> place.through
