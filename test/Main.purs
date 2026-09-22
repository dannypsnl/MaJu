module Test.Main (main) where

import Prelude

import Effect (Effect)
import Jj.GraphSpec as GraphSpec
import Test.Spec.Reporter (consoleReporter)
import Test.Spec.Runner.Node (runSpecAndExitProcess)

main :: Effect Unit
main = runSpecAndExitProcess [ consoleReporter ] do
  GraphSpec.spec
